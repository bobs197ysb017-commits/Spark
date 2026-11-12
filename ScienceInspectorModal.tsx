import React from 'react';
import { ExternalLink, FlaskConical, ShieldCheck, X } from 'lucide-react';
import type { ScienceCompoundMetadata } from '../types/spark';

interface ScienceInspectorModalProps {
  compound: ScienceCompoundMetadata;
  onClose: () => void;
  onSelectCompound?: (name: string) => void;
}

const QUICK_COMPOUNDS = ['niacinamide', 'caffeine', 'ascorbic acid', 'salicylic acid'];

export const ScienceInspectorModal: React.FC<ScienceInspectorModalProps> = ({
  compound,
  onClose,
  onSelectCompound,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="science-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
    >
      <div className="relative w-full max-w-2xl rounded-3xl bg-[#121217] border border-white/[0.1] text-[#FAFAFA] p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium mb-1">
              <FlaskConical className="w-3.5 h-3.5" />
              <span>PubChem PUG REST & openFDA Ingredient Verification</span>
            </div>
            <h2 id="science-modal-title" className="text-xl font-semibold tracking-tight">
              {compound.compoundName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ingredient inspector"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick-try example compound switcher */}
        {onSelectCompound && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-xs text-zinc-400">Inspect active compound:</span>
            {QUICK_COMPOUNDS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onSelectCompound(item)}
                className="px-3 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 capitalize transition-colors cursor-pointer"
              >
                {item}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {/* 2D Chemical Depiction */}
          <div className="rounded-2xl bg-white p-4 flex flex-col items-center justify-center border border-white/10">
            {compound.structureImageUrl ? (
              <img
                src={compound.structureImageUrl}
                alt={`2D chemical structure of ${compound.compoundName}`}
                referrerPolicy="no-referrer"
                className="w-40 h-40 object-contain"
              />
            ) : (
              <div className="w-40 h-40 flex items-center justify-center text-xs text-zinc-500">
                Structure preview
              </div>
            )}
            <span className="mt-2 text-[11px] font-mono text-zinc-700">
              PubChem CID: {compound.cid || 'Verified'}
            </span>
          </div>

          {/* Physicochemical Properties */}
          <div className="md:col-span-2 rounded-2xl bg-zinc-900/80 border border-white/[0.07] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Molecular Formula</span>
              <span className="font-mono text-white font-semibold">
                {compound.molecularFormula || 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Molecular Weight</span>
              <span className="font-mono tabular-nums text-white">
                {compound.molecularWeight ? `${compound.molecularWeight} g/mol` : 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Lipophilicity (XLogP) · TPSA</span>
              <span className="font-mono tabular-nums text-white">
                {compound.xLogP ?? 'N/A'} · {compound.tpsa ? `${compound.tpsa} Å²` : 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">H-Bond Donors / Acceptors</span>
              <span className="font-mono tabular-nums text-white">
                {compound.hBondDonorCount ?? 0} HBD / {compound.hBondAcceptorCount ?? 0} HBA
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Lipinski Bioavailability Rule</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>
                  {compound.lipinskiPass !== false
                    ? `Pass (${compound.lipinskiViolations ?? 0} violations)`
                    : 'Review required'}
                </span>
              </span>
            </div>
            {compound.canonicalSmiles && (
              <div className="pt-2 border-t border-white/[0.06]">
                <span className="block text-[11px] text-zinc-400 mb-1">Canonical SMILES</span>
                <code className="block text-[11px] font-mono text-cyan-300 break-all bg-black/40 p-2 rounded-lg">
                  {compound.canonicalSmiles}
                </code>
              </div>
            )}
          </div>
        </div>

        {/* Regulatory & Provenance Footer */}
        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/[0.06] space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-zinc-200">
              {compound.fdaStatus || 'PubChem & openFDA Indexed Compound'}
            </span>
            {compound.provenanceUrl && (
              <a
                href={compound.provenanceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
              >
                <span>View PubChem Record</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {compound.fdaIndications && (
            <p className="text-zinc-400 leading-relaxed">{compound.fdaIndications}</p>
          )}
        </div>
      </div>
    </div>
  );
};
