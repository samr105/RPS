// src/hooks/usePubs.js
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

export function usePubs() {
  const [pubs, setPubs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPubs = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (data) {
        // Ensure geom is always a string to prevent errors downstream
        setPubs(data.map(p => ({...p, geom: p.geom || ''})));
    }
    setIsLoading(false);
    return { data, error };
  }, []);

  useEffect(() => {
    fetchPubs();
  }, [fetchPubs]);

  return { pubs, isLoading, setPubs, refetchPubs: fetchPubs };
}