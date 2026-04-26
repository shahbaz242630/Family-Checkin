// Onboarding context - manages onboarding state across screens
import { createContext, useContext, useState, ReactNode } from 'react';

export interface OnboardingProfile {
  fullName: string;
  phone: string;
  countryCode: string;
  timezone: string;
}

export interface OnboardingLovedOne {
  name: string;
  relationship: string;
  phone: string;
  countryCode: string;
  timezone: string;
}

export interface OnboardingSchedule {
  frequency: 'daily' | 'every_2_days' | 'weekly' | 'custom';
  customDays?: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  specificTime: string; // HH:MM format
  method: 'sms' | 'whatsapp' | 'push';
}

export interface OnboardingEscalation {
  waitTime: '30min' | '1hour' | '2hours' | '4hours';
  action: 'notify_me' | 'call_emergency' | 'both';
  emergencyContact: {
    name: string;
    phone: string;
    countryCode: string;
  };
}

interface OnboardingData {
  profile: OnboardingProfile;
  lovedOne: OnboardingLovedOne;
  schedule: OnboardingSchedule;
  escalation: OnboardingEscalation;
}

interface OnboardingContextType {
  data: OnboardingData;
  currentStep: number;
  totalSteps: number;
  updateProfile: (profile: Partial<OnboardingProfile>) => void;
  updateLovedOne: (lovedOne: Partial<OnboardingLovedOne>) => void;
  updateSchedule: (schedule: Partial<OnboardingSchedule>) => void;
  updateEscalation: (escalation: Partial<OnboardingEscalation>) => void;
  setCurrentStep: (step: number) => void;
  resetOnboarding: () => void;
}

const defaultData: OnboardingData = {
  profile: {
    fullName: '',
    phone: '',
    countryCode: '+971', // UAE default for GCC
    timezone: 'Asia/Dubai',
  },
  lovedOne: {
    name: '',
    relationship: '',
    phone: '',
    countryCode: '+971',
    timezone: 'Asia/Dubai',
  },
  schedule: {
    frequency: 'daily',
    timeOfDay: 'morning',
    specificTime: '09:00',
    method: 'sms',
  },
  escalation: {
    waitTime: '1hour',
    action: 'both',
    emergencyContact: {
      name: '',
      phone: '',
      countryCode: '+971',
    },
  },
};

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 5;

  const updateProfile = (profile: Partial<OnboardingProfile>) => {
    setData((prev) => ({
      ...prev,
      profile: { ...prev.profile, ...profile },
    }));
  };

  const updateLovedOne = (lovedOne: Partial<OnboardingLovedOne>) => {
    setData((prev) => ({
      ...prev,
      lovedOne: { ...prev.lovedOne, ...lovedOne },
    }));
  };

  const updateSchedule = (schedule: Partial<OnboardingSchedule>) => {
    setData((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, ...schedule },
    }));
  };

  const updateEscalation = (escalation: Partial<OnboardingEscalation>) => {
    setData((prev) => ({
      ...prev,
      escalation: {
        ...prev.escalation,
        ...escalation,
        emergencyContact: {
          ...prev.escalation.emergencyContact,
          ...(escalation.emergencyContact || {}),
        },
      },
    }));
  };

  const resetOnboarding = () => {
    setData(defaultData);
    setCurrentStep(0);
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        currentStep,
        totalSteps,
        updateProfile,
        updateLovedOne,
        updateSchedule,
        updateEscalation,
        setCurrentStep,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
