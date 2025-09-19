import React from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
} from "@/components/ui/sidebar";
import {
  IconBrandTabler,
  IconListDetails,
  IconRobot,
  IconBroadcast,
  IconBook,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";

interface ClaudeBenchLayoutProps {
  children: React.ReactNode;
}

export function ClaudeBenchLayout({ children }: ClaudeBenchLayoutProps) {
  const location = useLocation();
  const [open, setOpen] = React.useState(false);

  const links = [
    {
      label: "Dashboard",
      href: "/",
      icon: (
        <IconBrandTabler className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />
      ),
    },
    {
      label: "Tasks",
      href: "/tasks",
      icon: (
        <IconListDetails className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />
      ),
    },
    {
      label: "Events",
      href: "/events",
      icon: (
        <IconBroadcast className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />
      ),
    },
    {
      label: "System",
      href: "/system",
      icon: (
        <IconRobot className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />
      ),
    },
    {
      label: "Docs",
      href: "/docs",
      icon: (
        <IconBook className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />
      ),
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row bg-gray-100 dark:bg-neutral-900 w-full flex-1 border-neutral-200 dark:border-neutral-700 overflow-hidden",
        "h-screen"
      )}
    >
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <Link
                  key={idx}
                  to={link.href}
                  className={cn(
                    "flex items-center justify-start gap-2 group/sidebar py-2 px-2 rounded-lg transition-colors",
                    location.pathname === link.href
                      ? "bg-neutral-200 dark:bg-neutral-800"
                      : "hover:bg-neutral-200 dark:hover:bg-neutral-800"
                  )}
                >
                  {link.icon}
                  {open && (
                    <span className="text-neutral-700 dark:text-neutral-200 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre">
                      {link.label}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2">
              <ModeToggle />
              {open && (
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  Theme
                </span>
              )}
            </div>
            <SidebarLink
              link={{
                label: "Worker-1",
                href: "#",
                icon: (
                  <div className="h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                    <span className="text-[10px] text-white font-bold">W1</span>
                  </div>
                ),
              }}
            />
          </div>
        </SidebarBody>
      </Sidebar>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

const Logo = () => {
  return (
    <Link
      to="/"
      className="font-normal flex space-x-2 items-center text-sm text-black dark:text-white py-1 relative z-20"
    >
      <div className="h-5 w-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
      <span className="font-medium text-black dark:text-white whitespace-pre">
        ClaudeBench
      </span>
    </Link>
  );
};

const LogoIcon = () => {
  return (
    <Link
      to="/"
      className="font-normal flex space-x-2 items-center text-sm text-black dark:text-white py-1 relative z-20"
    >
      <div className="h-5 w-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
    </Link>
  );
};