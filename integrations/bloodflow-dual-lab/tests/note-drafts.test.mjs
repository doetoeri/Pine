import test from 'node:test';
import assert from 'node:assert/strict';
import {NoteDrafts,noteScope} from '../src/note-drafts.mjs';

test('unconfirmed writing is isolated by room and role, including an empty draft',()=>{
 const d=new NoteDrafts(),a=noteScope({mode:'shared',code:'ABC123',role:'engineering'}),b=noteScope({mode:'shared',code:'ABC123',role:'biology'}),c=noteScope({mode:'shared',code:'DEF456',role:'engineering'});
 d.capture(a,'question','room A draft','confirmed');d.capture(b,'question','biology draft','confirmed');d.capture(c,'question','','room C confirmed');
 assert.equal(d.get(a,'question').value,'room A draft');assert.equal(d.get(b,'question').value,'biology draft');assert.equal(d.get(c,'question').value,'');assert.equal(d.get(null,'question'),undefined);assert.equal(noteScope({mode:'solo'}),null);assert.equal(d.size,3);
});

test('only the acknowledged event clears its own draft, without clearing another role or room',()=>{
 const d=new NoteDrafts();for(const [scope,id] of [['A:engineering','a'],['A:biology','b'],['B:engineering','c']]){d.capture(scope,'question','same text','');d.sent(scope,'question',id);}
 d.acknowledge('unknown');assert.equal(d.size,3);d.acknowledge('b');assert.equal(d.size,2);assert.equal(d.get('A:biology','question'),undefined);assert.equal(d.get('A:engineering','question').eventId,'a');assert.equal(d.get('B:engineering','question').eventId,'c');
});

test('typing while an earlier value awaits confirmation survives its acknowledgement',()=>{
 const d=new NoteDrafts();d.capture('A:engineering','engineering','first','base');d.sent('A:engineering','engineering','a');d.capture('A:engineering','engineering','newer','base');d.acknowledge('a');
 assert.equal(d.get('A:engineering','engineering').value,'newer');assert.equal(d.get('A:engineering','engineering').eventId,null);assert.match(d.get('A:engineering','engineering').issue,/아직 반영되지/);d.sent('A:engineering','engineering','b');d.acknowledge('b');assert.equal(d.size,0);
});

test('revision conflict or role error retains local text and the confirmed value at the start of editing',()=>{
 const d=new NoteDrafts();d.capture('A:engineering','question','my draft','first confirmed');d.sent('A:engineering','question','a');d.reject('a','다른 연구자가 변경했습니다.');d.capture('A:engineering','question','revised draft','peer confirmed');
 assert.deepEqual(d.export().drafts.map(x=>[x.value,x.confirmedAtEdit,x.issue]),[['revised draft','first confirmed','다른 연구자가 변경했습니다.']]);assert.equal(d.get('A:engineering','question').eventId,null);
});

test('disconnection retains a pending event for replay, but room change or server restart makes it explicitly unconfirmed',()=>{
 const d=new NoteDrafts();d.capture('A:engineering','question','unconfirmed','base');d.sent('A:engineering','question','a');d.reconcile(new Map([['a',{}]]));assert.equal(d.get('A:engineering','question').eventId,'a');d.reconcile(new Map());assert.equal(d.get('A:engineering','question').eventId,null);assert.match(d.get('A:engineering','question').issue,/직접 다시/);assert.equal(d.size,1);
});

test('reverting to confirmed text removes an unsent draft but cannot erase an in-flight change',()=>{
 const d=new NoteDrafts();d.capture('A:engineering','question','edit','base');d.capture('A:engineering','question','base','base');assert.equal(d.size,0);d.capture('A:engineering','question','edit','base');d.sent('A:engineering','question','a');d.capture('A:engineering','question','base','base');assert.equal(d.size,1);d.acknowledge('a');assert.equal(d.get('A:engineering','question').value,'base');assert.equal(d.get('A:engineering','question').eventId,null);
});

test('draft export is an independent UTF-8-safe review artifact without command identities or credentials',()=>{
 const d=new NoteDrafts();d.capture('ABC123:biology','biology','온도·보류 해석 <script>가 아닌 글</script>','');d.sent('ABC123:biology','biology','private-event-id');const artifact=JSON.parse(JSON.stringify(d.export()));assert.equal(artifact.format,'BLOODFLOW-NOTE-DRAFTS-1');assert.equal(artifact.drafts[0].role,'biology');assert.equal(artifact.drafts[0].room,'ABC123');assert.equal(artifact.drafts[0].awaitingAcknowledgement,true);assert.match(artifact.drafts[0].value,/온도/);assert.equal(JSON.stringify(artifact).includes('private-event-id'),false);assert.equal('snapshot' in artifact,false);
});
