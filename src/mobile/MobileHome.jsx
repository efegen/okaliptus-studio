import React from 'react';
import { MobileGreetingHeader } from './MobileGreetingHeader';
import { MobileKpiSection } from './MobileKpiSection';
import { MobileWeekCalendar } from './MobileWeekCalendar';

export function MobileHome({ user }) {
  return (
    <div className="mobile-home">
      <MobileGreetingHeader user={user} />
      <MobileKpiSection />
      <MobileWeekCalendar />
    </div>
  );
}
