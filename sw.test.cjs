const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function worker(){
  const handlers={},entries=new Map(),deleted=[];
  let network=0,installed=[];
  const cache={async match(key){return entries.get(key);},async addAll(reqs){installed=reqs.map(r=>r.url);}};
  const context={URL,Request:class{constructor(url){this.url=url;}},
    self:{registration:{scope:'https://example.test/elevator/'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener(k,f){handlers[k]=f;}},
    caches:{open:async name=>{assert.equal(name,'elevspeed-v35');return cache;},keys:async()=>['elevspeed-v34','elevspeed-v35','another-app'],delete:async key=>deleted.push(key)},
    fetch:async()=>{network++;return {status:503};}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
  return {handlers,entries,deleted,get network(){return network;},get installed(){return installed;},request(path,mode='navigate'){
    let result;handlers.fetch({request:{method:'GET',url:'https://example.test'+path,mode},respondWith(p){result=p;}});return result;
  }};
}
test('offline install includes the separate calculation engine',async()=>{
  const w=worker();let done;w.handlers.install({waitUntil(p){done=p;}});await done;
  assert.ok(w.installed.includes('./index.html'));assert.ok(w.installed.includes('./measurement.js'));
});
test('HTML and engine use the current offline bundle without network',async()=>{
  const w=worker();w.entries.set('./index.html','html-v35');w.entries.set('./measurement.js','engine-v35');
  assert.equal(await w.request('/elevator/'),'html-v35');
  assert.equal(await w.request('/elevator/index.html?installed=1'),'html-v35');
  assert.equal(await w.request('/elevator/measurement.js','cors'),'engine-v35');
  assert.equal(w.network,0);
});
test('unknown scripts are not served HTML as a fallback',()=>{
  const w=worker();assert.equal(w.request('/elevator/missing.js','cors'),undefined);
  assert.equal(w.request('/other-page/'),undefined);
});
test('activation removes only this apps old caches',async()=>{
  const w=worker();let done;w.handlers.activate({waitUntil(p){done=p;}});await done;
  assert.deepEqual(w.deleted,['elevspeed-v34']);
});
