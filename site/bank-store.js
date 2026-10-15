let activeBank;
export function setBank(bank){activeBank=bank;}
export function getBank(){if(!activeBank)throw Error('题库尚未加载完成。');return activeBank;}
