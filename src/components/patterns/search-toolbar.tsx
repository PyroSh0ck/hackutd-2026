"use client";
import { TextField } from "../forms/text-field";
import { Button } from "../ui/button";
import s from "@visual/ui.module.css";
export type SearchToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  loading?: boolean;
  placeholder?: string;
};
export function SearchToolbar({
  query,
  onQueryChange,
  onSearch,
  loading = false,
  placeholder = "Search…",
}: SearchToolbarProps) {
  return (
    <form
      role="search"
      className={s.row}
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading) onSearch();
      }}
    >
      <TextField
        type="search"
        label="Search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
      />
      <Button
        text="Search"
        leadingIcon="search"
        type="submit"
        loading={loading}
      />
    </form>
  );
}
