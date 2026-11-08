"use client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
export type EmptyStateProps = {
  title: string;
  description: string;
  action?: { text: string; onClick: () => void };
};
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card title={title} description={description}>
      {action && <Button text={action.text} onClick={action.onClick} />}
    </Card>
  );
}
