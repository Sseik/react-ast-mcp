// src/TestComponent.tsx
import React from "react";

interface HeaderProps {
  title: string;
  isLoggedIn: boolean;
}

export const Header = ({ title, isLoggedIn }: HeaderProps) => {
  return (
    <header>
      <h1>{title}</h1>
      {isLoggedIn && <button>Logout</button>}
    </header>
  );
};
