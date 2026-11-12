import React, { useState } from 'react';
import { Database } from 'lucide-react';

interface ProductArtworkProps {
  imageUrl: string | null;
  sourceName: string;
  name: string;
  className?: string;
}

export const ProductArtwork: React.FC<ProductArtworkProps> = ({
  imageUrl,
  sourceName,
  name,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      role="img"
      aria-label={name}
      className={`relative overflow-hidden bg-gradient-to-br from-[#16161D] via-[#101015] to-[#0A0A0E] flex items-center justify-center select-none ${className}`}
    >
      <div
        className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 blur-2xl"
        style={{
          background: 'radial-gradient(circle, #8b5cf6, transparent 70%)',
        }}
      />

      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-4 text-zinc-500">
          <Database className="w-6 h-6 text-zinc-600 mb-1.5" />
          <span className="text-[11px] font-mono text-zinc-400">
            No source image provided
          </span>
          <span className="text-[10px] text-zinc-500 mt-0.5">{sourceName}</span>
        </div>
      )}
    </div>
  );
};
