import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/i18n.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {dictionaries}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('all three languages have complete, nonempty UI dictionaries',()=>{
  const keys=Object.keys(dictionaries.en).sort();
  for(const language of ['te','hi','en']){
    assert.deepEqual(Object.keys(dictionaries[language]).sort(),keys);
    for(const key of keys)assert.ok(dictionaries[language][key].trim(),`${language}.${key}`);
  }
});
