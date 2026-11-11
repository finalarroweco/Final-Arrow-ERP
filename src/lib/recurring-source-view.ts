/** Prisma Decimal JSON drops insignificant zeros. Public billing source amounts
 * use the same exact three-decimal contract as previews and saved price lines. */
export function billingSourceView<T extends {subtotal:{toFixed:(places:number)=>string};taxAmount:{toFixed:(places:number)=>string}}>(row:T):Omit<T,'subtotal'|'taxAmount'>&{subtotal:string;taxAmount:string}{
 return {...row,subtotal:row.subtotal.toFixed(3),taxAmount:row.taxAmount.toFixed(3)};
}
