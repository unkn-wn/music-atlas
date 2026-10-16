import React, { useState, useRef, useEffect, useDeferredValue, useCallback } from 'react';

/**
 * Shared state for a search input with an autocomplete dropdown: query (deferred so typing stays smooth),
 * open state, keyboard-highlighted row and outside-click closing. Keyboard handling is local to the input.
 */
export function useSearchDropdown() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  // Results derive from the deferred query, so a new query resets the highlighted row
  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);

  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    itemCount: number,
    onPick: (index: number) => void
  ) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || itemCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + itemCount) % itemCount);
    } else if (e.key === 'Enter' && activeIndex < itemCount) {
      e.preventDefault();
      onPick(activeIndex);
    }
  };

  return {
    query,
    setQuery,
    deferredQuery,
    isOpen,
    setIsOpen,
    activeIndex,
    setActiveIndex,
    containerRef,
    inputRef,
    close,
    handleKeyDown
  };
}
