import React from 'react';

interface SiteLinksProps {
  className?: string;
  linkClassName?: string;
}

/** Real links to the static artist and genre indexes, so crawlers reach them from the app */
export const SiteLinks: React.FC<SiteLinksProps> = ({ className = '', linkClassName = '' }) => (
  <nav aria-label="Browse" className={className}>
    <a href="/artists/" className={linkClassName}>
      Artists A–Z
    </a>
    <a href="/genres/" className={linkClassName}>
      Genres
    </a>
  </nav>
);
