"use client";

import * as Headless from "@headlessui/react";
import clsx from "clsx";
import { LayoutGroup, motion } from "motion/react";
import React, { forwardRef, useId } from "react";
import { NavLink } from "react-router";
import { TouchTarget } from "./button";

export function Navbar({ className, ...props }: React.ComponentPropsWithoutRef<"nav">) {
  return (
    <nav
      {...props}
      className={clsx(className, "bg-sidebar flex flex-1 items-center gap-4 py-0.5")}
    />
  );
}

export function NavbarDivider({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div aria-hidden="true" {...props} className={clsx(className, "bg-border h-6 w-px")} />;
}

export function NavbarSection({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  let id = useId();

  return (
    <LayoutGroup id={id}>
      <div {...props} className={clsx(className, "flex items-center gap-3")} />
    </LayoutGroup>
  );
}

export function NavbarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div aria-hidden="true" {...props} className={clsx(className, "-ml-4 flex-1")} />;
}

export const NavbarItem = forwardRef(function NavbarItem(
  {
    current,
    className,
    children,
    ...props
  }: { current?: boolean; className?: string; children: React.ReactNode } & (
    | ({ to?: never } & Omit<Headless.ButtonProps, "as" | "className">)
    | ({ to: string } & Omit<React.ComponentPropsWithoutRef<typeof NavLink>, "className">)
  ),
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>,
) {
  let classes = clsx(
    // Base
    "relative flex min-w-0 items-center gap-3 rounded-lg p-2 text-left text-base/6 font-medium text-foreground sm:text-sm/5 bg-transparent",
    // Leading icon/icon-only
    "*:data-[slot=icon]:size-6 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:fill-muted-foreground sm:*:data-[slot=icon]:size-5",
    // Trailing icon (down chevron or similar)
    "*:not-nth-2:last:data-[slot=icon]:ml-auto *:not-nth-2:last:data-[slot=icon]:size-5 sm:*:not-nth-2:last:data-[slot=icon]:size-4",
    // Avatar
    "*:data-[slot=avatar]:-m-0.5 *:data-[slot=avatar]:size-7 *:data-[slot=avatar]:[--avatar-radius:var(--radius-md)] sm:*:data-[slot=avatar]:size-6",
    // Hover
    "data-hover:bg-accent data-hover:*:data-[slot=icon]:fill-foreground",
    // Active
    "data-active:bg-accent data-active:*:data-[slot=icon]:fill-foreground",
  );

  return (
    <span className={clsx(className, "relative")}>
      {typeof props.to === "string" ? (
        <NavLink
          {...props}
          className={({ isActive }) => clsx(classes, isActive && "data-[current=true]")}
          ref={ref as React.ForwardedRef<HTMLAnchorElement>}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="current-indicator"
                  className="bg-primary absolute inset-x-2 -bottom-1 h-0.5 rounded-full"
                />
              )}
              <TouchTarget>{children}</TouchTarget>
            </>
          )}
        </NavLink>
      ) : (
        <>
          {current && (
            <motion.span
              layoutId="current-indicator"
              className="bg-primary absolute inset-x-2 -bottom-1 h-0.5 rounded-full"
            />
          )}
          <Headless.Button
            {...props}
            className={clsx("cursor-default", classes)}
            data-current={current ? "true" : undefined}
            ref={ref}
          >
            <TouchTarget>{children}</TouchTarget>
          </Headless.Button>
        </>
      )}
    </span>
  );
});

export function NavbarLabel({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return <span {...props} className={clsx(className, "truncate")} />;
}
