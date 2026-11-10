/** Exact stored monetary amounts. Input boundaries own their magnitude limits. */
export function moneyMillis(value:string):bigint {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) throw new Error("Invalid exact monetary amount");
  const negative=value.startsWith("-"),[whole,fraction=""]=(negative?value.slice(1):value).split(".");
  const amount=BigInt(whole)*BigInt(1000)+BigInt(fraction.padEnd(3,"0"));
  return negative?-amount:amount;
}
export function moneyText(value:bigint):string {
  const negative=value<BigInt(0),amount=negative?-value:value;
  return (negative?"-":"")+String(amount/BigInt(1000))+"."+String(amount%BigInt(1000)).padStart(3,"0");
}
/** Round an exact ratio to an integer, HALF_UP (ties away from zero). */
export function roundRatio(numerator:bigint,denominator:bigint):bigint {
  if (denominator<=BigInt(0)) throw new Error("Expected a positive ratio denominator");
  const negative=numerator<BigInt(0),amount=negative?-numerator:numerator;
  const rounded=amount/denominator+(amount%denominator*BigInt(2)>=denominator?BigInt(1):BigInt(0));
  return negative?-rounded:rounded;
}
