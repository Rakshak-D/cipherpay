import React from 'react';
import { AlertTriangle } from 'lucide-react';

const AlertBanner = ({ message }) => {
  if (!message) return null;
  
  return (
    <div className="bg-danger/20 border border-danger/50 text-danger px-4 py-3 rounded-xl flex items-center gap-3 animate-fade-in mb-4">
      <AlertTriangle className="animate-pulse flex-shrink-0" />
      <div>
        <p className="font-bold">CHAIN INTEGRITY VIOLATED</p>
        <p className="text-sm opacity-90">{message}</p>
      </div>
    </div>
  );
};

export default AlertBanner;
