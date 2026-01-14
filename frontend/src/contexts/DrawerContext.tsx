// DrawerContext - manages sidebar and profile menu state
import { createContext, useContext, useState, ReactNode } from 'react';

interface DrawerContextType {
  isSidebarOpen: boolean;
  isProfileMenuOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  openProfileMenu: () => void;
  closeProfileMenu: () => void;
  toggleProfileMenu: () => void;
  closeAll: () => void;
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const openSidebar = () => {
    setIsProfileMenuOpen(false);
    setIsSidebarOpen(true);
  };

  const closeSidebar = () => setIsSidebarOpen(false);
  const toggleSidebar = () => {
    setIsProfileMenuOpen(false);
    setIsSidebarOpen((prev) => !prev);
  };

  const openProfileMenu = () => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen(true);
  };

  const closeProfileMenu = () => setIsProfileMenuOpen(false);
  const toggleProfileMenu = () => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen((prev) => !prev);
  };

  const closeAll = () => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen(false);
  };

  return (
    <DrawerContext.Provider
      value={{
        isSidebarOpen,
        isProfileMenuOpen,
        openSidebar,
        closeSidebar,
        toggleSidebar,
        openProfileMenu,
        closeProfileMenu,
        toggleProfileMenu,
        closeAll,
      }}
    >
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('useDrawer must be used within a DrawerProvider');
  }
  return context;
}
