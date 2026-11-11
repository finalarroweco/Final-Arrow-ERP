import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file, dependencies={}) {
 const exports={};
 new Function('require','exports',ts.transpileModule(readFileSync(new URL('../../src/lib/'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>dependencies[name]??require(name),exports);
 return exports;
}
export const locale=load('locale');
export const apiResponse=load('api-response',{'./locale':locale});
