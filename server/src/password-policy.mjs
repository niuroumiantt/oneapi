export const passwordPolicy=Object.freeze({minLength:8,maxLength:128,requireUppercase:true,requireLowercase:true,requireSymbol:true});
// Valid scrypt hash used to perform equivalent password work for unknown credentials.
export const dummyPasswordHash='d83c3867cafb35497467ed489dadb1c4:ca7ac48314289f3a1f2fdf6502a26196dc7003cbcc3e6f067d6ebe98f60cd4206d0c634c376bd9d24e2df513f0cab8bab40312e860aca047b432ae37862ae626';
export const passwordMessage='密码须为 8–128 位，包含大写字母、小写字母和符号（空格不算符号）。';
export function validPassword(value){return typeof value==='string'&&value.length>=8&&value.length<=128&&/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(value);}
