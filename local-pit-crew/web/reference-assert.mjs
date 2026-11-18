// Assertions for the closed authored programs, never a generated-code verifier.
function fail(actual,expected){throw Error('Expected '+String(actual)+' to equal '+String(expected));}
export const referenceAssert={
 equal(actual,expected){if(!Object.is(actual,expected))fail(actual,expected);},
 notEqual(actual,expected){if(Object.is(actual,expected))throw Error('Expected separate values or references');},
 deepEqual(actual,expected){
  if(!Array.isArray(actual)||!Array.isArray(expected)||actual.length!==expected.length||actual.some((value,index)=>!Object.is(value,expected[index])))fail(actual,expected);
 }
};
