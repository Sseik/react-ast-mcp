import React, { memo } from "react";

// Child component wrapped in memo
export const UserCard = memo(({ user, onEdit }: any) => {
  return <div>{user.name}</div>;
});

// Parent component breaking memoization
export const Dashboard = () => {
  return (
    <div>
      <UserCard
        user={{ name: "Alex", role: "Admin" }} // This is an inline object!
        users={["a", "b", "c"]} // This is an inline array!
        onEdit={() => console.log("Edit")} // This is an inline function!
      />
    </div>
  );
};
