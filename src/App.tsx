/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, Volume2, StopCircle, AlertCircle, Info, List, Download, X, Share2, Map as MapIcon, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { KERALA_STOPS } from './constants';
import { BusStop } from './types';

// Fix Leaflet marker icon issue
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Map Recenter Component
function RecenterMap({ coords }: { coords: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([coords.lat, coords.lng], 15);
  }, [coords, map]);
  return null;
}

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [nextStop, setNextStop] = useState<BusStop | null>(null);
  const [currentStop, setCurrentStop] = useState<BusStop | null>(null);
  const [sourceStop, setSourceStop] = useState<BusStop | null>(null);
  const [destinationStop, setDestinationStop] = useState<BusStop | null>(null);
  const [distanceToNext, setDistanceToNext] = useState<number | null>(null);
  const [announcedStops, setAnnouncedStops] = useState<Set<string>>(new Set());
  const announcedStopsRef = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showRoute, setShowRoute] = useState(true);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Function to request Wake Lock
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        setWakeLock(lock);
        console.log('Wake Lock is active');
      } catch (err) {
        console.error('Wake Lock error:', err);
      }
    }
  };

  // Function to release Wake Lock
  const releaseWakeLock = () => {
    if (wakeLock) {
      wakeLock.release().then(() => {
        setWakeLock(null);
        console.log('Wake Lock released');
      });
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Bus Stop Announcer',
      text: 'ബസ് സ്റ്റോപ്പുകൾ മലയാളത്തിൽ അറിയിക്കുന്ന ആപ്പ്. ഇൻസ്റ്റാൾ ചെയ്ത് ഉപയോഗിക്കൂ!',
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        alert('ലിങ്ക് കോപ്പി ചെയ്തിട്ടുണ്ട്. നിങ്ങൾക്ക് ഇത് പേസ്റ്റ് ചെയ്ത് അയക്കാം.');
      }
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  // Function to calculate distance between two points in KM
  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const announceMessage = async (message: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: message }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioData = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }

        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }

        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        
        const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => setIsSpeaking(false);
        source.start(0);
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error("Speech error:", err);
      setIsSpeaking(false);
    }
  };

  const announceStop = async (stopName: string, isArriving: boolean = false) => {
    // Natural Malayalam prompt
    const prompt = isArriving 
      ? `നമ്മൾ ${stopName} എത്താറായിരിക്കുന്നു. ദയവായി ശ്രദ്ധിക്കുക.`
      : `അടുത്ത സ്റ്റോപ്പ് ${stopName} ആണ്. ദയവായി ശ്രദ്ധിക്കുക.`;
    
    await announceMessage(prompt);
  };

  useEffect(() => {
    let watchId: number;

    if (isTracking) {
      if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            setLocation({ lat: latitude, lng: longitude });
            setAccuracy(accuracy);

            // Determine direction and route stops
            let relevantStops = [...KERALA_STOPS];
            if (sourceStop && destinationStop) {
              const sourceIdx = KERALA_STOPS.findIndex(s => s.id === sourceStop.id);
              const destIdx = KERALA_STOPS.findIndex(s => s.id === destinationStop.id);
              
              if (sourceIdx <= destIdx) {
                // Forward route
                relevantStops = KERALA_STOPS.slice(sourceIdx, destIdx + 1);
              } else {
                // Backward route
                relevantStops = KERALA_STOPS.slice(destIdx, sourceIdx + 1).reverse();
              }
            } else if (destinationStop) {
              // Legacy behavior if only destination is set
              let closestId = -1;
              let distToClosest = Infinity;
              KERALA_STOPS.forEach(s => {
                const d = getDistance(latitude, longitude, s.lat, s.lng);
                if (d < distToClosest) {
                  distToClosest = d;
                  closestId = KERALA_STOPS.findIndex(st => st.id === s.id);
                }
              });

              const destIdx = KERALA_STOPS.findIndex(s => s.id === destinationStop.id);
              if (destIdx < closestId) {
                relevantStops = KERALA_STOPS.slice(destIdx, closestId + 1).reverse();
              } else {
                relevantStops = KERALA_STOPS.slice(closestId, destIdx + 1);
              }
            }

            let foundNext = null;
            let foundCurrent = null;
            let minNextDist = Infinity;

            // 1. Find current stop (closest one within 500m)
            let closestIdx = -1;
            let minClosestDist = Infinity;
            relevantStops.forEach((s, idx) => {
              const d = getDistance(latitude, longitude, s.lat, s.lng);
              if (d < minClosestDist) {
                minClosestDist = d;
                closestIdx = idx;
              }
            });

            if (closestIdx !== -1 && minClosestDist < 0.5) {
              foundCurrent = relevantStops[closestIdx];
            }

            // 2. Find next stop (first stop in sequence that is > 300m away and not yet arrived)
            for (let i = 0; i < relevantStops.length; i++) {
              const stop = relevantStops[i];
              const dist = getDistance(latitude, longitude, stop.lat, stop.lng);
              
              // Announcement logic
              // 1. "Next stop is..." (Announce when 1.2km away)
              if (dist < 1.2 && dist > 0.6 && !announcedStopsRef.current.has(`${stop.id}_next`)) {
                announceStop(stop.name, false);
                announcedStopsRef.current.add(`${stop.id}_next`);
                setAnnouncedStops(new Set(announcedStopsRef.current));
              }

              // 2. "Arriving at..." (Announce when 0.3km away)
              if (dist < 0.3 && !announcedStopsRef.current.has(`${stop.id}_arriving`)) {
                announceStop(stop.name, true);
                announcedStopsRef.current.add(`${stop.id}_arriving`);
                setAnnouncedStops(new Set(announcedStopsRef.current));

                // If this was the destination, stop tracking
                if (destinationStop && stop.id === destinationStop.id) {
                  setTimeout(() => setIsTracking(false), 5000);
                }
              }
              
              // Next stop is the first one in the array that we haven't reached yet
              if (!foundNext && dist > 0.2 && !announcedStopsRef.current.has(`${stop.id}_arriving`)) {
                foundNext = stop;
                minNextDist = dist;
              }
            }
            
            setNextStop(foundNext);
            setCurrentStop(foundCurrent);
            setDistanceToNext(minNextDist === Infinity ? null : minNextDist);
          },
          (err) => {
            let msg = "ലൊക്കേഷൻ ലഭ്യമാക്കാൻ സാധിക്കുന്നില്ല.";
            if (err.code === 1) {
              msg = "ലൊക്കേഷൻ പെർമിഷൻ നിഷേധിച്ചിരിക്കുന്നു. ദയവായി സൈറ്റ് സെറ്റിംഗ്‌സിൽ ലൊക്കേഷൻ അനുവദിക്കുക.";
            } else if (err.code === 2) {
              msg = "ലൊക്കേഷൻ സിഗ്നൽ ലഭ്യമല്ല. ദയവായി GPS ഓൺ ആണെന്ന് ഉറപ്പുവരുത്തുക.";
            } else if (err.code === 3) {
              msg = "ലൊക്കേഷൻ ലഭിക്കാൻ വൈകുന്നു. ദയവായി ഒന്നുകൂടി ശ്രമിക്കുക.";
            }
            setError(msg);
            setIsTracking(false);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } else {
        setError("നിങ്ങളുടെ ഫോണിൽ ഈ സൗകര്യം ലഭ്യമല്ല.");
      }
    }

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [isTracking]); // Removed announcedStops from dependencies to prevent watchPosition restarts

  return (
    <div className="min-h-screen bg-[#F0F7FF] text-[#0F172A] font-sans p-4 flex flex-col items-center select-none">
      {/* Header */}
      <header className="w-full max-w-md flex justify-between items-center mb-6 mt-4">
        <div className="text-left">
          <h1 className="text-2xl font-black text-[#2563EB] tracking-tight">ബസ് അനൗൺസർ</h1>
          <p className="text-[10px] font-bold text-[#2563EB] opacity-60 uppercase tracking-widest">Malayalam Voice Guide</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => window.location.reload()} 
            className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors"
            title="Refresh App"
          >
            <RefreshCw size={20} className="text-[#2563EB]" />
          </button>
          <button 
            onClick={() => announceMessage("ഓഡിയോ സിസ്റ്റം പ്രവർത്തിക്കുന്നുണ്ട്.")} 
            className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors"
            title="Test Audio"
          >
            <Volume2 size={20} className={isSpeaking ? "text-blue-600 animate-pulse" : "text-[#2563EB]"} />
          </button>
          <button onClick={handleShare} className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors">
            <Share2 size={20} className="text-[#2563EB]" />
          </button>
          <button onClick={() => setShowStops(true)} className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors">
            <List size={20} className="text-[#2563EB]" />
          </button>
          <button onClick={() => setShowAbout(true)} className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors">
            <Info size={20} className="text-[#2563EB]" />
          </button>
        </div>
      </header>

      {/* Main Card */}
      <main className="w-full max-w-md bg-white rounded-[48px] shadow-2xl p-10 flex flex-col items-center relative overflow-hidden border-4 border-white">
        {/* Decorative background element */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl" />
        
        {/* Status Indicator */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          <div className="flex items-center gap-2 bg-slate-50 px-4 py-1.5 rounded-full border border-slate-100">
            <div className={`w-2.5 h-2.5 rounded-full ${isTracking ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              {isTracking ? `GPS Active (${accuracy ? Math.round(accuracy) : '?'}m)` : 'GPS Offline'}
            </span>
          </div>
          {wakeLock && (
            <div className="flex items-center gap-2 bg-blue-50 px-4 py-1.5 rounded-full border border-blue-100">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">
                Screen Awake
              </span>
            </div>
          )}
        </div>

        {/* Big Visualizer */}
        <div className="relative mb-10">
          <AnimatePresence>
            {isTracking && (
              <>
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1.8, opacity: 0.1 }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-blue-500 rounded-full"
                />
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 2.2, opacity: 0.05 }}
                  transition={{ repeat: Infinity, duration: 3, delay: 0.5 }}
                  className="absolute inset-0 bg-blue-400 rounded-full"
                />
              </>
            )}
          </AnimatePresence>
          <div className="w-44 h-44 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center relative z-10 border-8 border-white shadow-xl">
            {isTracking ? (
              <Navigation className="w-20 h-20 text-white animate-pulse" />
            ) : (
              <MapPin className="w-20 h-20 text-white/30" />
            )}
          </div>
        </div>

        {/* Info Display */}
        <div className="w-full min-h-[140px] flex flex-col items-center justify-center mb-6">
          <AnimatePresence mode="wait">
            {error ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center text-red-500 px-4 bg-red-50 py-4 rounded-3xl border border-red-100 w-full"
              >
                <AlertCircle size={24} className="mx-auto mb-2" />
                <p className="text-sm font-bold leading-relaxed mb-4">{error}</p>
                <button 
                  onClick={() => { setError(null); setIsTracking(true); }}
                  className="flex items-center gap-2 bg-red-100 text-red-700 px-4 py-2 rounded-full mx-auto text-xs font-black"
                >
                  <RefreshCw size={14} /> വീണ്ടും ശ്രമിക്കുക
                </button>
              </motion.div>
            ) : isTracking ? (
              <motion.div 
                key={nextStop?.id || 'searching'}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center w-full"
              >
                <div className="flex flex-col gap-4 w-full mb-6">
                  {currentStop && (
                    <div className="bg-green-50 px-4 py-3 rounded-2xl border border-green-100 flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-[9px] font-black text-green-600 uppercase tracking-widest">ഇപ്പോഴുള്ള സ്റ്റോപ്പ്</p>
                        <p className="text-lg font-bold text-slate-700">{currentStop.name}</p>
                      </div>
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white">
                        <MapPin size={16} />
                      </div>
                    </div>
                  )}
                  
                  {nextStop && (
                    <div className="bg-blue-50 px-4 py-3 rounded-2xl border border-blue-100 flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">അടുത്ത സ്റ്റോപ്പ്</p>
                        <p className="text-lg font-bold text-slate-700">{nextStop.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">ദൂരം</p>
                        <p className="text-sm font-bold text-blue-600">
                          {distanceToNext !== null && (
                            distanceToNext < 1 
                              ? `${Math.round(distanceToNext * 1000)}m` 
                              : `${distanceToNext.toFixed(1)}km`
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {!nextStop && !currentStop && (
                  <p className="text-xl font-bold text-slate-300 animate-pulse">ലൊക്കേഷൻ തിരയുന്നു...</p>
                )}
              </motion.div>
            ) : (
              <div className="text-center w-full">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">യാത്ര തുടങ്ങാൻ സ്റ്റോപ്പുകൾ തിരഞ്ഞെടുക്കുക</p>
                <div className="grid grid-cols-1 gap-4">
                  <div className="relative">
                    <p className="text-left text-[9px] font-black text-slate-400 uppercase mb-1 ml-2">എവിടെ നിന്ന് (Source)</p>
                    <select 
                      onChange={(e) => {
                        const stop = KERALA_STOPS.find(s => s.id === e.target.value);
                        setSourceStop(stop || null);
                      }}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:border-blue-500 outline-none appearance-none"
                      value={sourceStop?.id || ""}
                    >
                      <option value="">യാത്ര തുടങ്ങുന്ന സ്റ്റോപ്പ്</option>
                      {KERALA_STOPS.map(stop => (
                        <option key={stop.id} value={stop.id}>{stop.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="relative">
                    <p className="text-left text-[9px] font-black text-slate-400 uppercase mb-1 ml-2">എവിടേക്ക് (Destination)</p>
                    <select 
                      onChange={(e) => {
                        const stop = KERALA_STOPS.find(s => s.id === e.target.value);
                        setDestinationStop(stop || null);
                      }}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:border-blue-500 outline-none appearance-none"
                      value={destinationStop?.id || ""}
                    >
                      <option value="">ഇറങ്ങേണ്ട സ്റ്റോപ്പ്</option>
                      {KERALA_STOPS.map(stop => (
                        <option key={stop.id} value={stop.id}>{stop.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Map View */}
        {isTracking && location && (
          <div className="w-full mb-6">
            <div className="flex justify-between items-center mb-2 px-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <MapIcon size={12} /> Live Map
              </span>
              <button 
                onClick={() => setShowMap(!showMap)}
                className="text-[10px] font-black text-blue-600 uppercase"
              >
                {showMap ? 'Hide Map' : 'Show Map'}
              </button>
            </div>
            
            {showMap && (
              <div className="w-full h-48 rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner relative z-0">
                <MapContainer 
                  center={[location.lat, location.lng]} 
                  zoom={15} 
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />
                  <Marker position={[location.lat, location.lng]}>
                    <Popup>നിങ്ങൾ ഇപ്പോൾ ഇവിടെയാണ്</Popup>
                  </Marker>
                  {nextStop && (
                    <Marker position={[nextStop.lat, nextStop.lng]} opacity={0.6}>
                      <Popup>അടുത്ത സ്റ്റോപ്പ്: {nextStop.name}</Popup>
                    </Marker>
                  )}
                  <RecenterMap coords={location} />
                </MapContainer>
              </div>
            )}
          </div>
        )}

        {/* Vertical Route View (Where is my Train style) */}
        {isTracking && sourceStop && destinationStop && (
          <div className="w-full mb-8">
            <div className="flex justify-between items-center mb-4 px-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Navigation size={12} /> Route Progress
              </span>
              <button 
                onClick={() => setShowRoute(!showRoute)}
                className="text-[10px] font-black text-blue-600 uppercase"
              >
                {showRoute ? 'Hide Route' : 'Show Route'}
              </button>
            </div>

            {showRoute && (
              <div className="bg-slate-50 rounded-[32px] p-6 border border-slate-100 max-h-64 overflow-y-auto custom-scrollbar">
                <div className="relative">
                  {/* Vertical Line */}
                  <div className="absolute left-3 top-2 bottom-2 w-1 bg-slate-200 rounded-full" />
                  
                  <div className="flex flex-col gap-6">
                    {(() => {
                      const sourceIdx = KERALA_STOPS.findIndex(s => s.id === sourceStop.id);
                      const destIdx = KERALA_STOPS.findIndex(s => s.id === destinationStop.id);
                      const stops = sourceIdx <= destIdx 
                        ? KERALA_STOPS.slice(sourceIdx, destIdx + 1)
                        : KERALA_STOPS.slice(destIdx, sourceIdx + 1).reverse();
                      
                      return stops.map((stop, idx) => {
                        const isCurrent = currentStop?.id === stop.id;
                        const isNext = nextStop?.id === stop.id;
                        const isPassed = announcedStops.has(`${stop.id}_arriving`);

                        return (
                          <div key={stop.id} className="flex items-center gap-4 relative">
                            {/* Dot */}
                            <div className={`w-7 h-7 rounded-full border-4 border-white shadow-sm z-10 flex items-center justify-center ${
                              isCurrent ? 'bg-green-500 scale-125' : 
                              isNext ? 'bg-blue-500 animate-pulse' : 
                              isPassed ? 'bg-slate-400' : 'bg-slate-200'
                            }`}>
                              {isCurrent && <MapPin size={12} className="text-white" />}
                            </div>
                            
                            <div className="flex flex-col">
                              <span className={`text-sm font-bold ${
                                isCurrent ? 'text-green-600' : 
                                isNext ? 'text-blue-600' : 
                                isPassed ? 'text-slate-400' : 'text-slate-600'
                              }`}>
                                {stop.name}
                              </span>
                              {isCurrent && <span className="text-[8px] font-black text-green-500 uppercase">You are here</span>}
                              {isNext && <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">Next Stop</span>}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Action Button */}
        <button
          onClick={() => {
            setError(null);
            
            // Initialize AudioContext on user interaction
            if (!audioContextRef.current) {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              // Play a silent buffer to "unlock" audio on some mobile browsers
              const silentBuffer = audioContextRef.current.createBuffer(1, 1, 24000);
              const source = audioContextRef.current.createBufferSource();
              source.buffer = silentBuffer;
              source.connect(audioContextRef.current.destination);
              source.start(0);
            }

            if (!isTracking) {
              announcedStopsRef.current = new Set();
              setAnnouncedStops(new Set());
              requestWakeLock();
              // Announce start immediately to confirm audio works
              announceMessage("യാത്ര ആരംഭിച്ചിരിക്കുന്നു. സ്റ്റോപ്പുകൾ കൃത്യമായി അറിയിക്കുന്നതാണ്. ശുഭയാത്ര നേരുന്നു.");
            } else {
              releaseWakeLock();
            }
            setIsTracking(!isTracking);
          }}
          className={`w-full py-7 rounded-[32px] flex items-center justify-center gap-4 text-2xl font-black transition-all active:scale-95 shadow-2xl ${
            isTracking 
              ? 'bg-slate-900 text-white' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isTracking ? (
            <><StopCircle size={32} /> നിർത്തുക</>
          ) : (
            <><Volume2 size={32} /> യാത്ര തുടങ്ങാം</>
          )}
        </button>
      </main>

      {/* Quick Install Prompt */}
      <button 
        onClick={() => setShowInstall(true)}
        className="mt-8 flex items-center gap-2 bg-blue-100 text-blue-700 px-6 py-3 rounded-full font-bold text-sm shadow-sm hover:bg-blue-200 transition-colors"
      >
        <Download size={18} />
        ഫോണിൽ ഇൻസ്റ്റാൾ ചെയ്യാം
      </button>

      {/* About Modal */}
      <AnimatePresence>
        {showAbout && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[40px] p-10 relative"
            >
              <button onClick={() => setShowAbout(false)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full">
                <X size={20} />
              </button>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Info className="text-blue-600" size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-800">ആപ്പിനെക്കുറിച്ച്</h3>
              </div>
              <div className="space-y-4 text-sm leading-relaxed text-slate-600">
                <p>ഈ ആപ്ലിക്കേഷൻ ബസ് യാത്രക്കാർക്ക്, പ്രത്യേകിച്ച് കാഴ്ച പരിമിതിയുള്ളവർക്കും പ്രായമായവർക്കും സ്റ്റോപ്പുകൾ കൃത്യമായി മനസ്സിലാക്കാൻ സഹായിക്കുന്നു.</p>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                  <h4 className="font-bold text-blue-800 mb-2">പ്രധാന സവിശേഷതകൾ:</h4>
                  <ul className="list-disc list-inside space-y-1">
                    <li>മലയാളം വോയ്‌സ് അനൗൺസ്‌മെന്റ്</li>
                    <li>GPS ഉപയോഗിച്ചുള്ള കൃത്യമായ ലൊക്കേഷൻ</li>
                    <li>ലളിതമായ ഡിസൈൻ</li>
                    <li>ഇന്റർനെറ്റ് ഉപയോഗം കുറവ്</li>
                  </ul>
                </div>
                <p className="text-[10px] text-center opacity-50 mt-6">Developed with care for the community.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stops List Modal */}
      <AnimatePresence>
        {showStops && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          >
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="bg-white w-full max-w-md rounded-[32px] p-8 max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-[#5A5A40]">സ്റ്റോപ്പുകളുടെ ലിസ്റ്റ്</h3>
                <button onClick={() => setShowStops(false)} className="p-2 bg-[#F5F5F0] rounded-full">
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 pr-2 space-y-3">
                {KERALA_STOPS.map(stop => (
                  <div key={stop.id} className="p-4 bg-blue-50 rounded-2xl flex items-center gap-4 border border-blue-100">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-black">
                      {stop.id}
                    </div>
                    <span className="text-lg font-bold text-slate-700">{stop.name}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Install Instructions Modal */}
      <AnimatePresence>
        {showInstall && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 text-center"
            >
              <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Download className="text-blue-600" size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-6">ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്യാൻ</h3>
              <div className="text-left space-y-4 text-sm text-slate-600 mb-8">
                <p>1. ബ്രൗസറിന്റെ മുകളിൽ വലതുവശത്തുള്ള <b>മൂന്ന് കുത്തുകളിൽ (⋮)</b> അമർത്തുക.</p>
                <p>2. <b>'Install App'</b> അല്ലെങ്കിൽ <b>'Add to Home Screen'</b> എന്നത് തിരഞ്ഞെടുക്കുക.</p>
                <p>3. ഇപ്പോൾ നിങ്ങളുടെ ഫോണിലെ മറ്റു ആപ്പുകളെപ്പോലെ ഇത് ഉപയോഗിക്കാം.</p>
              </div>
              <button 
                onClick={() => setShowInstall(false)}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-200"
              >
                ശരി
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-auto py-6 flex flex-col items-center gap-1">
        <div className="flex items-center gap-2 text-blue-600 opacity-40">
          <Info size={12} />
          <span className="text-[10px] font-black uppercase tracking-widest">Accessibility First Design</span>
        </div>
      </footer>
    </div>
  );
}
