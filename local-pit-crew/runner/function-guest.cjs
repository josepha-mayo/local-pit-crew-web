'use strict';
// Trusted programs compiled inside QuickJS before candidate initialization.
// Expected answers never enter the guest. Only invocation arguments do.
const FUNCTION_LOADER_SOURCE=`(function(){
 const Compile=Function;
 return function(source){const module={exports:{}};Compile('module','exports',source)(module,module.exports);return module.exports;};
})()`;
const FUNCTION_OBSERVER_SOURCE=`(function(){
 const Parse=JSON.parse,Stringify=JSON.stringify,Apply=Reflect.apply,Names=Object.getOwnPropertyNames,Symbols=Object.getOwnPropertySymbols,
  Descriptors=Object.getOwnPropertyDescriptors,Proto=Object.getPrototypeOf,SetProto=Object.setPrototypeOf,Create=Object.create,
  IsArray=Array.isArray,Finite=Number.isFinite,Is=Object.is,Plain=Object.prototype,Weak=WeakSet;
 const Own=Function.prototype.call.bind(Object.prototype.hasOwnProperty),Has=Function.prototype.call.bind(WeakSet.prototype.has),
  Add=Function.prototype.call.bind(WeakSet.prototype.add),Delete=Function.prototype.call.bind(WeakSet.prototype.delete);
 function encode(value){
  const active=new Weak();let nodes=0;
  function copy(v,depth){
   if(++nodes>256||depth>6)throw 0;
   if(v===null||typeof v==='boolean')return v;
   if(typeof v==='number'){if(!Finite(v))throw 0;return v;}
   if(typeof v==='string'){if(v.length>512)throw 0;return v;}
   if(!v||typeof v!=='object'||Has(active,v))throw 0;Add(active,v);
   const d=Descriptors(v),keys=Names(d);if(Symbols(d).length)throw 0;let out;
   if(IsArray(v)){
    const n=d.length.value;if(n>256||keys.length!==n+1)throw 0;out=[];SetProto(out,null);
    for(let i=0;i<n;i++){const p=d[Stringify(i)];if(!p||!Own(p,'value'))throw 0;out[i]=copy(p.value,depth+1);}
   }else{
    const p=Proto(v);if(p!==Plain&&p!==null||keys.length>32)throw 0;out=Create(null);
    for(let i=0;i<keys.length;i++){
     const k=keys[i],p=d[k];if(k.length>80||k==='__proto__'||k==='constructor'||k==='prototype'||!Own(p,'value')||!p.enumerable)throw 0;
     out[k]=copy(p.value,depth+1);
    }
   }
   Delete(active,v);return out;
  }
  function serialize(v){
   if(v===null||typeof v!=='object')return Is(v,-0)?'-0':Stringify(v);
   let out;
   if(IsArray(v)){out='[';for(let i=0;i<v.length;i++)out+=(i?',':'')+serialize(v[i]);return out+']';}
   const keys=Names(v);out='{';for(let i=0;i<keys.length;i++)out+=(i?',':'')+Stringify(keys[i])+':'+serialize(v[keys[i]]);return out+'}';
  }
  const result=serialize(copy(value,0));if(result.length>6000)throw 0;return result;
 }
 return function(fn,argsJSON){
  const args=Parse(argsJSON);let result,status='returned',output=null,after=null;
  try{result=Apply(fn,undefined,args);}catch{status='threw';}
  try{after=encode(args);}catch{/* Non-data mutation is itself a failed example. */}
  if(status==='returned'){try{output=encode(result);}catch{status='unserializable';}}
  return '{"status":'+Stringify(status)+',"output":'+(output===null?'null':Stringify(output))+',"argsAfter":'+(after===null?'null':Stringify(after))+'}';
 };
})()`;
module.exports={FUNCTION_LOADER_SOURCE,FUNCTION_OBSERVER_SOURCE};
