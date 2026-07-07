import React from 'react';
import { can } from './permissions';

// Oturum açan kullanıcıyı (id, username, displayName, role) uygulama ağacında
// prop threading olmadan erişilebilir kılar. Root, App'i (web + mobil) bununla
// sarar. Rol-bazlı UI gizleme için `useCan(capability)` kullanılır — güvenlik
// yine sunucuda (requireCan); bu yalnız kozmetik.

const CurrentUserContext = React.createContext(null);

export function CurrentUserProvider({ user, children }) {
  return (
    <CurrentUserContext.Provider value={user}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  return React.useContext(CurrentUserContext);
}

// Geçerli kullanıcının rolü verilen yetkiye sahip mi? (kullanıcı yoksa false)
export function useCan(capability) {
  const user = React.useContext(CurrentUserContext);
  return can(user?.role, capability);
}
