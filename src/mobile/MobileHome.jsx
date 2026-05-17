import React from 'react';
import { MobileGreetingHeader } from './MobileGreetingHeader';
import { MobileFinanceSummary } from './home/MobileFinanceSummary';
import { MobileAgenda } from './home/MobileAgenda';

export function MobileHome({ user, onLogout }) {
  return (
    <div className="mobile-home">
      <MobileGreetingHeader user={user} onLogout={onLogout} />
      <MobileFinanceSummary />
      <MobileAgenda />
    </div>
  );
}
