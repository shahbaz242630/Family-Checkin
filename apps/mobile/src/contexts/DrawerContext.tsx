// DrawerContext - manages sidebar and profile menu state
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

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

  const openSidebar = useCallback(() => {
    setIsProfileMenuOpen(false);
    setIsSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => {
    setIsProfileMenuOpen(false);
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const openProfileMenu = useCallback(() => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen(true);
  }, []);

  const closeProfileMenu = useCallback(() => setIsProfileMenuOpen(false), []);
  const toggleProfileMenu = useCallback(() => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen((prev) => !prev);
  }, []);

  const closeAll = useCallback(() => {
    setIsSidebarOpen(false);
    setIsProfileMenuOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      isSidebarOpen,
      isProfileMenuOpen,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      openProfileMenu,
      closeProfileMenu,
      toggleProfileMenu,
      closeAll,
    }),
    [
      isSidebarOpen,
      isProfileMenuOpen,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      openProfileMenu,
      closeProfileMenu,
      toggleProfileMenu,
      closeAll,
    ],
  );

  return (
    <DrawerContext.Provider value={value}>
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
