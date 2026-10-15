/**
 * One M-PESA payment from tap to settled, for any screen: starts the STK push, follows its
 * status, and drives the MpesaPromptSheet. start() and status() are the endpoint calls.
 *   const flow = usePayFlow({ start: () => api(...), status: (id) => api(...), onPaid });
 *   <Button onPress={flow.pay} />  <MpesaPromptSheet {...flow.sheet} phone=... />
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FUNNEL } from '@safiri/shared';
import { track } from '../../analytics';
import { SETTLED } from './api';

const SHEET_STATUS = { initiated: 'sending', pending: 'waiting', succeeded: 'paid', failed: 'failed', cancelled: 'failed', timed_out: 'timed_out' };

export function usePayFlow({ key, start, status, onPaid, onError }) {
  const [payment, setPayment] = useState(null); // { paymentId, amountKes }
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const poll = useQuery({
    queryKey: ['hold', 'pay-flow', key, payment?.paymentId],
    enabled: Boolean(payment?.paymentId),
    queryFn: () => status(payment.paymentId),
    refetchInterval: (q) => (SETTLED.includes(q.state.data?.status) ? false : 3000),
  });
  const current = poll.data?.status;

  const paidOnce = useRef(null);
  useEffect(() => {
    if (current !== 'succeeded' || paidOnce.current === payment?.paymentId) return;
    paidOnce.current = payment.paymentId;
    track(FUNNEL.PAID, { amountKes: payment.amountKes });
    onPaid?.(poll.data);
  }, [current, payment, poll.data, onPaid]);

  const pay = async () => {
    setPayment(null);
    setOpen(true);
    setStarting(true);
    try {
      const started = await start();
      setPayment({ paymentId: started.paymentId, amountKes: started.amountKes });
      track(FUNNEL.STK_SENT, { amountKes: started.amountKes });
    } catch (err) {
      setOpen(false);
      onError?.(err);
    } finally {
      setStarting(false);
    }
  };

  return {
    pay,
    busy: starting,
    sheet: {
      visible: open,
      amountKes: payment?.amountKes || 0,
      status: starting || !payment ? 'sending' : SHEET_STATUS[current] || 'waiting',
      onRetry: pay,
      onChangeNumber: () => setOpen(false),
      onClose: () => {
        if (!payment || SETTLED.includes(current)) setOpen(false);
      },
    },
  };
}
