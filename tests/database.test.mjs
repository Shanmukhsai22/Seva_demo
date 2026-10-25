import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Supabase migration: roles, private data, payment boundaries, assignments, bookings and outbox',async()=>{
  const db = new PGlite();
  try {
    // Stand-ins only for Supabase-owned schemas/roles, not application routines.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb,phone_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    `);
    await db.exec(await fs.readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8'));
    const ids=Array.from({length:5},()=>crypto.randomUUID());
    for(let i=0;i<ids.length;i++) await db.query(`insert into auth.users values($1,$2,$3,now())`,[ids[i],`9198765432${10+i}`,JSON.stringify({name:`Member ${i}`,language:'te',whatsapp_opt_in:i===3,role:'admin'})]);
    const users=(await db.query('select role from profiles')).rows;
    assert.ok(users.every(p=>p.role==='user'),'signup metadata cannot grant admin');
    await db.query(`update profiles set role='admin' where id=$1`,[ids[0]]);
    await db.query(`update profiles set role='ayyagaru' where id=$1`,[ids[1]]);
    await assert.rejects(db.query(`update profiles set role='admin' where id=$1`,[ids[2]]),/one_super_admin/);
    assert.equal((await db.query(`select has_function_privilege('anon','public.book_event(uuid,uuid)','execute') as allowed`)).rows[0].allowed,false);
    assert.equal((await db.query(`select has_table_privilege('authenticated','public.consultations','select') as allowed`)).rows[0].allowed,false);
    await assert.rejects(db.query(`select * from create_consultation($1,'image.jpg','Question')`,[ids[3]]),/setupRequired/);
    await db.exec('update service_settings set consultation_fee_paise=50000');
    const paid=(await db.query(`select * from create_consultation($1,'paid.jpg','Paid request')`,[ids[3]])).rows[0];
    assert.equal(paid.status,'awaiting_payment');assert.equal(paid.assigned_to,null);
    await assert.rejects(db.query('select reassign_consultation($1,$2)',[paid.id,ids[1]]),/forbidden/);
    await db.exec('update service_settings set consultation_fee_paise=0');
    const first=(await db.query(`select * from create_consultation($1,'free1.jpg','First question')`,[ids[3]])).rows[0];
    const second=(await db.query(`select * from create_consultation($1,'free2.jpg','Second question')`,[ids[4]])).rows[0];
    assert.equal(first.status,'assigned');assert.equal(first.assigned_to,ids[1]);assert.equal(second.status,'pending');
    await assert.rejects(db.query('select complete_consultation($1,$2,$3)',[first.id,ids[2],'Wrong assignee']),/forbidden/);
    await db.query('select complete_consultation($1,$2,$3)',[first.id,ids[1],'Guidance']);
    assert.equal((await db.query('select status from consultations where id=$1',[second.id])).rows[0].status,'assigned');
    const translations=JSON.stringify({te:'కార్యక్రమం',hi:'कार्यक्रम',en:'Event'});
    const event=(await db.query(`insert into events(title,description,venue,starts_at,fee_paise,capacity,created_by) values($1,$1,$1,now()+interval '1 day',0,1,$2) returning id`,[translations,ids[0]])).rows[0];
    await db.query('select publish_event($1)',[event.id]);
    await db.query('select publish_event($1)',[event.id]);
    assert.equal((await db.query(`select count(*)::int as n from notifications where kind='event_announcement'`)).rows[0].n,1,'publishing is idempotent and opt-in only');
    const booking=(await db.query('select * from book_event($1,$2)',[event.id,ids[3]])).rows[0];
    assert.equal(booking.status,'confirmed');
    await assert.rejects(db.query('select book_event($1,$2)',[event.id,ids[3]]),/alreadyBooked/);
    await assert.rejects(db.query('select book_event($1,$2)',[event.id,ids[4]]),/eventFull/);
    const counts=(await db.query('select * from event_booking_counts()')).rows;
    assert.equal(Number(counts[0].confirmed_count),1);
    const paidEvent=(await db.query(`insert into events(title,description,venue,starts_at,fee_paise,capacity,created_by,published) values($1,$1,$1,now()+interval '1 day',10000,1,$2,true) returning id`,[translations,ids[0]])).rows[0];
    const pending=(await db.query('select * from book_event($1,$2)',[paidEvent.id,ids[3]])).rows[0];
    assert.equal(pending.status,'awaiting_payment');
    assert.equal((await db.query(`select count(*)::int as n from notifications where kind='booking_confirmation' and reference_id=$1`,[pending.id])).rows[0].n,0);
    const claims=(await db.query('select * from claim_notifications()')).rows;
    assert.ok(claims.length>0);assert.ok(claims.every(x=>x.status==='processing'));
    assert.equal((await db.query('select * from claim_notifications()')).rows.length,0,'claimed messages cannot be claimed again');
  } finally {await db.close();}
});
