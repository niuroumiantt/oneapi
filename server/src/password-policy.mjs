export const passwordPolicy=Object.freeze({minLength:8,maxLength:128,requireUppercase:true,requireLowercase:true,requireSymbol:true});
export const passwordMessage='密码须为 8–128 位，包含大写字母、小写字母和符号（空格不算符号）。';
export function validPassword(value){return typeof value==='string'&&value.length>=8&&value.length<=128&&/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(value);}
