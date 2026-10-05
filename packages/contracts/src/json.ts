/** A strict JSON value. `undefined`, functions, NaN and Infinity are not representable. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
