-- Apply once in a new Supabase project. All business writes go through FastAPI.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  phone text unique not null,
  role text not null default 'user' check (role in ('admin','ayyagaru','user')),
  language text not null default 'te' check (language in ('te','hi','en')),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  available boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_super_admin on public.profiles(role) where role = 'admin';
create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is not null then
    insert into public.profiles(id,name,phone,language,whatsapp_opt_in,whatsapp_opt_in_at)
    values(new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),'Member'),100),
      '+' || ltrim(new.phone,'+'),
      case when new.raw_user_meta_data->>'language' in ('te','hi','en') then new.raw_user_meta_data->>'language' else 'te' end,
      coalesce(new.raw_user_meta_data->>'whatsapp_opt_in','false') = 'true',
      case when new.raw_user_meta_data->>'whatsapp_opt_in' = 'true' then now() end);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.create_profile();

create table public.service_settings (
  id integer primary key default 1 check (id = 1),
  consultation_fee_paise integer check (consultation_fee_paise >= 0 and consultation_fee_paise <= 100000000)
);
insert into public.service_settings(id) values(1);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null, description jsonb not null, venue jsonb not null,
  starts_at timestamptz not null,
  fee_paise integer not null check(fee_paise >= 0 and fee_paise <= 100000000),
  capacity integer not null check(capacity between 1 and 100000),
  published boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  user_id uuid not null references public.profiles(id),
  status text not null check(status in ('awaiting_payment','confirmed','cancelled','expired')),
  fee_paise integer not null,
  created_at timestamptz not null default now(),
  unique(event_id,user_id)
);
create index bookings_event_status on public.bookings(event_id,status);
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  image_path text not null unique,
  notes text not null check(length(notes) between 1 and 4000),
  fee_paise integer not null,
  status text not null check(status in ('awaiting_payment','pending','assigned','completed')),
  assigned_to uuid references public.profiles(id),
  response text check(length(response) <= 10000),
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  completed_at timestamptz,
  check ((status in ('assigned','completed')) = (assigned_to is not null)),
  check (status <> 'completed' or length(trim(response)) > 0)
);
create index consultations_assignee_status on public.consultations(assigned_to,status);
create unique index one_active_consultation_per_ayyagaru on public.consultations(assigned_to) where status='assigned';
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('event_announcement','booking_confirmation','consultation_completed')),
  reference_id uuid not null,
  status text not null default 'queued' check(status in ('queued','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  unique(recipient_id,kind,reference_id)
);
create index notifications_pending on public.notifications(status,next_attempt_at);

-- Backend-only routines. Locking keeps assignment, bookings, and outbox writes atomic.
create function public.assign_waiting_consultations() returns void language plpgsql set search_path = '' as $$
declare request_record record; assignee uuid;
begin
  perform pg_advisory_xact_lock(981726);
  for request_record in select id from public.consultations where status='pending' order by created_at for update loop
    select p.id into assignee from public.profiles p
    where p.role='ayyagaru' and p.available and not exists(select 1 from public.consultations c where c.assigned_to=p.id and c.status='assigned')
    order by (select max(c.assigned_at) from public.consultations c where c.assigned_to=p.id) nulls first,p.created_at limit 1;
    exit when assignee is null;
    update public.consultations set assigned_to=assignee,status='assigned',assigned_at=now() where id=request_record.id;
  end loop;
end $$;

create function public.create_consultation(p_user uuid,p_image text,p_notes text) returns public.consultations language plpgsql set search_path = '' as $$
declare fee integer; result public.consultations;
begin
  select consultation_fee_paise into fee from public.service_settings where id=1;
  if fee is null then raise exception 'setupRequired'; end if;
  insert into public.consultations(user_id,image_path,notes,fee_paise,status)
    values(p_user,p_image,p_notes,fee,case when fee=0 then 'pending' else 'awaiting_payment' end) returning * into result;
  perform public.assign_waiting_consultations();
  select * into result from public.consultations where id=result.id;
  return result;
end $$;

create function public.book_event(p_event uuid,p_user uuid) returns public.bookings language plpgsql set search_path = '' as $$
declare e public.events; result public.bookings; booked integer;
begin
  select * into e from public.events where id=p_event and published for update;
  if not found or e.starts_at <= now() then raise exception 'eventClosed'; end if;
  if exists(select 1 from public.bookings where event_id=p_event and user_id=p_user) then raise exception 'alreadyBooked'; end if;
  select count(*) into booked from public.bookings where event_id=p_event and status='confirmed';
  if booked >= e.capacity then raise exception 'eventFull'; end if;
  -- Pending paid bookings do not reserve inventory or issue invitations.
  insert into public.bookings(event_id,user_id,status,fee_paise)
  values(p_event,p_user,case when e.fee_paise=0 then 'confirmed' else 'awaiting_payment' end,e.fee_paise) returning * into result;
  if result.status='confirmed' then
    insert into public.notifications(recipient_id,kind,reference_id)
    select p_user,'booking_confirmation',result.id from public.profiles where id=p_user and whatsapp_opt_in on conflict do nothing;
  end if;
  return result;
end $$;

create function public.publish_event(p_event uuid) returns void language plpgsql set search_path = '' as $$
begin
  update public.events set published=true where id=p_event and not published and starts_at>now();
  if found then
    insert into public.notifications(recipient_id,kind,reference_id)
    select p.id,'event_announcement',p_event from public.profiles p join auth.users u on u.id=p.id
    where p.whatsapp_opt_in and u.phone_confirmed_at is not null on conflict do nothing;
  end if;
end $$;

create function public.complete_consultation(p_request uuid,p_assignee uuid,p_response text) returns void language plpgsql set search_path = '' as $$
declare owner_id uuid;
begin
  perform pg_advisory_xact_lock(981726);
  if length(trim(p_response)) < 1 or length(p_response)>10000 then raise exception 'noteRequired'; end if;
  update public.consultations set status='completed',response=p_response,completed_at=now()
  where id=p_request and assigned_to=p_assignee and status='assigned' returning user_id into owner_id;
  if not found then raise exception 'forbidden'; end if;
  insert into public.notifications(recipient_id,kind,reference_id)
  select owner_id,'consultation_completed',p_request from public.profiles where id=owner_id and whatsapp_opt_in on conflict do nothing;
  perform public.assign_waiting_consultations();
end $$;

create function public.reassign_consultation(p_request uuid,p_assignee uuid) returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(981726);
  if not exists(select 1 from public.profiles where id=p_assignee and role='ayyagaru' and available)
    or exists(select 1 from public.consultations where assigned_to=p_assignee and status='assigned' and id<>p_request) then raise exception 'forbidden'; end if;
  update public.consultations set assigned_to=p_assignee,status='assigned',assigned_at=now()
  where id=p_request and status in ('pending','assigned');
  if not found then raise exception 'forbidden'; end if;
end $$;

create function public.claim_notifications() returns setof public.notifications language sql set search_path = '' as $$
  update public.notifications set status='processing',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
  where id in (select id from public.notifications where status='queued' and next_attempt_at<=now() and attempts<5 order by created_at for update skip locked limit 10)
  returning *;
$$;

create function public.event_booking_counts() returns table(event_id uuid,confirmed_count bigint) language sql set search_path = '' as $$
  select event_id,count(*) from public.bookings where status='confirmed' group by event_id;
$$;

-- No direct client-side business writes. API checks JWTs and explicit roles.
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.bookings enable row level security;
alter table public.consultations enable row level security;
alter table public.notifications enable row level security;
alter table public.service_settings enable row level security;
create policy own_profile on public.profiles for select to authenticated using(auth.uid()=id);
revoke all on public.profiles,public.events,public.bookings,public.consultations,public.notifications,public.service_settings from anon,authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles,public.events,public.bookings,public.consultations,public.notifications,public.service_settings to service_role;

revoke execute on function public.create_profile() from public,anon,authenticated;
revoke execute on function public.assign_waiting_consultations() from public,anon,authenticated;
revoke execute on function public.create_consultation(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.book_event(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.publish_event(uuid) from public,anon,authenticated;
revoke execute on function public.complete_consultation(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.reassign_consultation(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.claim_notifications() from public,anon,authenticated;
revoke execute on function public.event_booking_counts() from public,anon,authenticated;
grant execute on function public.event_booking_counts() to service_role;
grant execute on function public.assign_waiting_consultations(),public.create_consultation(uuid,text,text),public.book_event(uuid,uuid),public.publish_event(uuid),public.complete_consultation(uuid,uuid,text),public.reassign_consultation(uuid,uuid),public.claim_notifications() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('jatakams','jatakams',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Intentionally no client storage policies. API validates ownership before signed reads.
