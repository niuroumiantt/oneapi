import test from 'node:test';
import assert from 'node:assert/strict';
import {validPassword} from '../src/password-policy.mjs';
test('password policy accepts 8 to 128 characters with upper/lower/symbol, without requiring digits',()=>{
 for(const s of ['Abcdefg!','Abcdefg1!','Ab'+'.'.repeat(126),'Abcdefg]','Abcdefg\\'])assert.equal(validPassword(s),true);
 for(const s of ['',null,{},'Abcde!','abcdefgh!','ABCDEFGH!','Abcdefgh','Abcdefg ','Abcdefg中','Ab'+'.'.repeat(127)])assert.equal(validPassword(s),false);
});
