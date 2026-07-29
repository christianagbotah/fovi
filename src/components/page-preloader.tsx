'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const LOADING_TEXTS = [
  'Loading markets...',
  'Connecting to brokers...',
  'Initializing AI engine...',
  'Almost ready...',
];

interface PagePreloaderProps {
  isLoaded: boolean;
  onComplete?: () => void;
}

export function PagePreloader({ isLoaded, onComplete }: PagePreloaderProps) {
  const [textIndex, setTextIndex] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % LOADING_TEXTS.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      setShow(false);
      onComplete?.();
    }, 600);
    return () => clearTimeout(timer);
  }, [isLoaded, onComplete]);

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {show && (
        <motion.div
          key="preloader"
          className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        >
          <motion.div
            className="w-16 h-16 rounded-2xl"
            animate={{
              scale: [1, 1.08, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <img src="/logo.png" alt="Fovi AI" className="w-full h-full rounded-2xl" />
          </motion.div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">Fovi AI</h1>
          <div className="mt-2 h-5 flex items-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={textIndex}
                className="text-sm text-muted-foreground"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
              >
                {LOADING_TEXTS[textIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 2, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
