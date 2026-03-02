const base = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
export const apiUrl = (path: string) => `${base}${path}`;
