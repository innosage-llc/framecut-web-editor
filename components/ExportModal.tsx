
import React from 'react';
import { Loader2 } from 'lucide-react';

interface ExportModalProps {
    isExporting: boolean;
    progress: number;
}

const ExportModal: React.FC<ExportModalProps> = ({ isExporting, progress }) => {
    if (!isExporting && (progress === 0 || progress === 100)) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center">
            <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl text-center">
                <div className="mb-4 relative inline-flex items-center justify-center">
                    <Loader2 size={48} className="animate-spin text-blue-500" />
                    <span className="absolute text-[10px] font-bold">{progress}%</span>
                </div>
                <h3 className="text-lg font-semibold mb-1">Exporting Video...</h3>
                <p className="text-sm text-zinc-500">Please do not close this tab.</p>
            </div>
        </div>
    );
};

export default ExportModal;
