// Optional WebGL integration check: run against the static review server. See review/impacts/RESULTS.md.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto((process.env.IMPACT_REVIEW_URL || 'http://127.0.0.1:5012/tests/impact-browser.html'));await page.waitForFunction(()=>window.ready,null,{timeout:60000});
 const results=await page.evaluate(async()=>{
  const t=impactReview.t, results=[];
  // Exercise each recipe's lifetime and pending work before complete combat sequences.
  for (const kind of ['gun', 'salvo', 'missile', 'subMissile', 'strike', 'torpedo']) {
   impactReview.kind.value = kind;
   impactReview.wet.checked = kind === 'torpedo';
   impactReview.seek(.15);
   const finite = [...t.effects.p.pos.slice(0, t.effects.count * 3)].every(Number.isFinite);
   const rings = t.effects.rings.pool.filter(r => r.mesh.visible && r.water && r.t < r.duration).length;
   if (!finite || (kind === 'torpedo' ? !rings : rings)) throw new Error('Invalid effect: ' + kind);
   impactReview.seek(20);
   if (t.effects.count || t.effects.debris.items.length || t.effects.fireballs.items.length || t.effects.pending.length) throw new Error('Effect did not expire: ' + kind);
   impactReview.seek(.03);
   t.effects.clear();
   t.effects.update(5, t.camera);
   if (t.effects.count || t.effects.fireballs.items.length) throw new Error('Reset spawned effects: ' + kind);
  }
  const specs=[['Destroyer','gun',2],['Battleship','salvo',4],['Cruiser','missile',3],['Submarine','subMissile',3],['Carrier','strike',5],['Submarine','torpedo',3]];
  for(const [type,weapon,n] of specs){
   t.effects.clear(); t.combat.clear();
   await t.deploy('gpt',[{name:type,direction:'H',cells:'ABCDE'.slice(0,n).split('').map(c=>c+'3')}],{animate:false});
   await t.deploy('claude',[{name:'Battleship',direction:'H',cells:['D5','E5','F5','G5']}],{animate:false});
   const shooter=t.fleets.gpt.ships.get(type);shooter.weapons=[weapon];t.fleets.gpt.pickShooter=()=>shooter;
   const calls=[],original=t.effects.explosion;
   t.effects.explosion=function(at,scale,options){calls.push({kind:options.kind,round:options.round,velocity:options.velocity?.length()});return original.call(this,at,scale,options)};
   let done=false;const shot=t.playShot({player:'gpt',target:'E5',result:'hit',ship:'Battleship'}).then(()=>done=true);
   for(let i=0;i<1800&&!done;i++){t.step(1/60);await Promise.resolve();await Promise.resolve();}
   t.effects.explosion=original;
   if(!done)throw new Error('Shot stalled: '+weapon);
   await shot;
   const primary=calls.find(c=>c.kind===weapon);
   if(!primary || !(primary.velocity>0))throw new Error('Missing velocity '+weapon+JSON.stringify(calls));
   if(weapon==='gun'&&primary.round.mass!==2.4)throw new Error('Wrong light shell');
   if(weapon==='torpedo'&&primary.round)throw new Error('Torpedo uses missile round');
   if(!t.fleets.claude.ships.get('Battleship').burningCells.has('E5'))throw new Error('Damage missing');
   results.push({weapon,done,calls:calls.length,velocity:primary.velocity,mass:primary.round?.mass});
  }
  t.render();return results;
 });console.log(JSON.stringify({results,errors},null,2));if(errors.length)throw new Error('Browser errors');
 } finally {await browser.close()}
})();
