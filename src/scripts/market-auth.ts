export type AuthUser = { username: string; name: string; role: 'admin' | 'company' | 'buyer'; imported: boolean };
const AUTH_URL = import.meta.env.PUBLIC_AUTH_URL || 'https://functions.yandexcloud.net/d4e3mh06a9gisbmto7gi';
const TOKEN = 'zipmarket_jwt_token';
const USER = 'zipmarket_auth_user';

export function getCurrentUser(): AuthUser | null {
  try {
    const token = localStorage.getItem(TOKEN);
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) { logout(); return null; }
    return { username: payload.username, name: payload.name, role: payload.role || 'buyer', imported: Boolean(payload.imported) };
  } catch { return null; }
}

export async function loginWithServer(username: string, password: string): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
  try {
    const response = await fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ action: 'login', username: username.trim(), password: password.trim() }) });
    const data = await response.json();
    if (!response.ok || !data.success || !data.token) return { success: false, message: data.message || 'Неверный логин или пароль' };
    localStorage.setItem(TOKEN, data.token); localStorage.setItem(USER, JSON.stringify(data.user));
    window.dispatchEvent(new CustomEvent('zipmarket:auth-changed', { detail: { user: data.user } }));
    return { success: true, user: data.user };
  } catch { return { success: false, message: 'Ошибка связи с сервером авторизации' }; }
}

export function logout() { localStorage.removeItem(TOKEN); localStorage.removeItem(USER); window.dispatchEvent(new CustomEvent('zipmarket:auth-changed', { detail: { user: null } })); }
