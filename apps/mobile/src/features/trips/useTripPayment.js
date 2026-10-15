/** Paying a trip's next instalment from the Trips or Pay tab (one prompt at a time). */
import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { holdTokens } from '../build/api';
import { usePayFlow } from '../pay/usePayFlow';

const KNOWN = ['payment_in_progress', 'mpesa_unavailable', 'mpesa_not_configured', 'amount_over_limit', 'not_payable'];

const tokenQuery = (id) => {
  const token = holdTokens.get(id);
  return token ? `?token=${encodeURIComponent(token)}` : '';
};

export function useTripPayment() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // A ref, not state: pay() must see the trip chosen in this same tap.
  const tripRef = useRef(null);
  const [payingId, setPayingId] = useState(null);

  const flow = usePayFlow({
    key: payingId,
    start: () => {
      const trip = tripRef.current;
      return api('/v1/payments', {
        method: 'POST',
        body: { bookingId: trip.bookingId, option: 'instalment', phone: `0${trip.phone.slice(3)}`, token: holdTokens.get(trip.bookingId) || undefined },
      });
    },
    status: (paymentId) => api(`/v1/payments/${paymentId}${tokenQuery(tripRef.current.bookingId)}`),
    onPaid: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
    onError: (err) =>
      Alert.alert(t('pay.title'), t(KNOWN.includes(err.code) ? `checkout.errors.${err.code}` : err.offline ? 'errors.network' : 'errors.generic')),
  });

  return {
    flow,
    payingId,
    phone: tripRef.current?.phone,
    payFor: (trip) => {
      tripRef.current = trip;
      setPayingId(trip.bookingId);
      flow.pay();
    },
  };
}
