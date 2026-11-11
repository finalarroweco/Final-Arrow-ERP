/** Local to one mounted bank workspace. Never a session observer or authorization cache. */
export class BankReadIdentity {
 generation=0;
 private listeners=new Set<()=>void>();
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 invalidate(){this.generation++;for(const listener of this.listeners)listener();}
}
