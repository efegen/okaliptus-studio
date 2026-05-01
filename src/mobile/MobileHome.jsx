import React from 'react';
import { MobileGreetingHeader } from './MobileGreetingHeader';

export function MobileHome({ user }) {
  return (
    <div className="mobile-home">
      <MobileGreetingHeader user={user} />
    </div>
  );
}
