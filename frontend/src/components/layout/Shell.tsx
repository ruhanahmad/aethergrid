import type { ReactNode } from "react";

import { CommandPalette } from "../common/CommandPalette";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { useCommandPalette } from "../../hooks/useCommandPalette";

interface ShellProps {
  children: ReactNode;
  stackNavigationOnMobile?: boolean;
}

export function Shell({
  children,
  stackNavigationOnMobile = false,
}: ShellProps) {
  const { isOpen, close } = useCommandPalette();

  return (
    <div className="min-h-screen bg-slate-950">

      <Header />

      <div className={stackNavigationOnMobile ? "flex flex-col md:flex-row" : "flex"}>

        <Sidebar stackNavigationOnMobile={stackNavigationOnMobile} />

        <main className={stackNavigationOnMobile ? "min-w-0 flex-1 p-4 md:p-8" : "flex-1 p-8"}>
          {children}
        </main>

      </div>

      <CommandPalette isOpen={isOpen} onClose={close} />

    </div>
  );
}
