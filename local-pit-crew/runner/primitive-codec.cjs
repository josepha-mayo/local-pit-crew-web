'use strict';
// Capture pristine guest functions before loading any candidate. JSON string
// literals preserve NULs and unpaired UTF-16 surrogates across the UTF-8 C API.
// Only primitive strings enter these functions; object conversion hooks cannot run.
function createPrimitiveCodec(context,{keep,take}){
 const parse=take(context.evalCode('(function(){const parse=JSON.parse;return function(text){return parse(text);};})()'));
 const stringify=take(context.evalCode('(function(){const stringify=JSON.stringify;return function(text){return stringify(text);};})()'));
 const isNull=take(context.evalCode('(function(value){return value===null;})'));
 return{
  fromString(value){
   if(typeof value!=='string')throw Error('primitive-codec-invalid');
   return take(context.callFunction(parse,context.undefined,keep(context.newString(JSON.stringify(value)))));
  },
  toString(value){
   if(context.typeof(value)!=='string')throw Error('primitive-codec-invalid');
   const encoded=take(context.callFunction(stringify,context.undefined,value));
   const result=JSON.parse(context.getString(encoded));
   if(typeof result!=='string')throw Error('primitive-codec-invalid');return result;
  },
  typeOf(value){
   const type=context.typeof(value);
   return type==='object'&&context.getNumber(take(context.callFunction(isNull,context.undefined,value)))===1?'null':type;
  }
 };
}
module.exports={createPrimitiveCodec};
