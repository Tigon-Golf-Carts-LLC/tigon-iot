// Track 3 — customer page /q/:code: the cart, the out-the-door price, payment options, "I'm interested", book a test drive.
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { Call, CheckCircle, Event, Sms, ThumbUp } from '@mui/icons-material';
import PublicShell from '../public/PublicShell';
import { publicGet, publicPost } from '../public/publicApi';
import { money } from './closingUtils';
import type { QuoteRow } from '../salesTypes';

/** Delivery over 4 hours (3rd-party carrier): price confirmed separately, not in the total. */
const QUOTE_TBC = 'Delivery (3rd-party carrier)';

interface StoreInfo { id: string; name: string; city: string; address: string; phone: string }
interface PublicQuote {
  code: string; expired: boolean; cartTitle: string; photo: string; videoUrl: string; brand: string; cartPrice: number; accessories: number;
  prepFee: number; deliveryFee: number; deliveryTbc?: boolean; militaryDiscount: number; salesTax: number; otd: number; downPayment: number; tradeIn: number;
  loanAmount: number; rows: QuoteRow[]; salespersonName: string; salespersonPhone: string; store: StoreInfo | null; customerFirst: string;
  createdAt: number; expiresAt: number; interested: boolean; bookPath: string;
}

const isVideoFile = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) || /firebasestorage\.googleapis\.com/.test(u);
const youTubeId = (u: string) => (u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/) || [])[1] || '';

const QuotePublicPage: React.FC = () => {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    publicGet<PublicQuote>(`quote/get/${encodeURIComponent(code)}${preview ? '?preview=1' : ''}`)
      .then(setQ).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, preview]);

  const interested = async () => {
    setBusy(true);
    setSendError('');
    try {
      await publicPost('quote/interested', { code, preferredTime: when, note });
      setSent(true);
      setAsking(false);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const phone = q?.salespersonPhone || q?.store?.phone || '1-844-844-6638';
  const tel = phone.replace(/[^\d+]/g, '');

  if (error) {
    return <PublicShell title="Your quote" phone="1-844-844-6638"><Alert severity="warning">{error}</Alert></PublicShell>;
  }
  if (!q) {
    return <PublicShell title="Your quote"><Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box></PublicShell>;
  }

  const lines: Array<[string, number]> = [
    ['Cart price', q.cartPrice],
    ...(q.accessories ? [['Accessories', q.accessories] as [string, number]] : []),
    ...(q.prepFee ? [['Dealer prep', q.prepFee] as [string, number]] : []),
    ...(q.deliveryFee ? [['Delivery', q.deliveryFee] as [string, number]] : []),
    ...(q.deliveryTbc ? [[QUOTE_TBC, 0] as [string, number]] : []),
    ...(q.militaryDiscount ? [['Military discount', -q.militaryDiscount] as [string, number]] : []),
    ...(q.salesTax ? [['Sales tax', q.salesTax] as [string, number]] : []),
  ];
  const yt = q.videoUrl ? youTubeId(q.videoUrl) : '';
  const isInterested = sent || q.interested;

  return (
    <PublicShell title={q.customerFirst && q.customerFirst !== 'there' ? `${q.customerFirst}, here's your quote` : 'Your quote'}
      subtitle={q.cartTitle || q.brand} phone={phone}>
      {preview && <Alert severity="info" sx={{ mb: 2 }}>Preview — opening it here does not count as the customer opening it.</Alert>}
      {q.expired && <Alert severity="warning" sx={{ mb: 2 }}>This quote has expired. Prices and rates may have changed — call {phone} for an updated quote.</Alert>}

      {(q.photo || q.videoUrl) && (
        <Card sx={{ mb: 2, overflow: 'hidden' }}>
          {yt ? (
            <Box sx={{ position: 'relative', pt: '56.25%' }}>
              <Box component="iframe" src={`https://www.youtube.com/embed/${yt}`} title="Cart video" allowFullScreen
                sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
            </Box>
          ) : q.videoUrl && isVideoFile(q.videoUrl) ? (
            <Box component="video" src={q.videoUrl} poster={q.photo || undefined} controls playsInline sx={{ width: '100%', display: 'block', bgcolor: '#000', maxHeight: 520 }} />
          ) : q.photo ? (
            <Box component="img" src={q.photo} alt={q.cartTitle} sx={{ width: '100%', display: 'block', maxHeight: 520, objectFit: 'cover' }} />
          ) : null}
          {q.videoUrl && !yt && !isVideoFile(q.videoUrl) && (
            <Box sx={{ p: 1.5 }}><Button href={q.videoUrl} target="_blank" rel="noopener noreferrer">Watch the video</Button></Box>
          )}
        </Card>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Price</Typography>
            <Table size="small">
              <TableBody>
                {lines.map(([l, v]) => (
                  <TableRow key={l}><TableCell sx={{ border: 0, py: 0.25, pl: 0 }}>{l}</TableCell><TableCell align="right" sx={{ border: 0, py: 0.25, pr: 0 }}>{l === QUOTE_TBC ? 'To be confirmed' : money(v)}</TableCell></TableRow>
                ))}
                <TableRow><TableCell sx={{ fontWeight: 800, pl: 0 }}>Out-the-door price</TableCell><TableCell align="right" sx={{ fontWeight: 800, pr: 0 }}>{money(q.otd)}</TableCell></TableRow>
                {q.tradeIn > 0 && <TableRow><TableCell sx={{ border: 0, py: 0.25, pl: 0 }}>Trade-in</TableCell><TableCell align="right" sx={{ border: 0, py: 0.25, pr: 0 }}>−{money(q.tradeIn)}</TableCell></TableRow>}
                {q.downPayment > 0 && <TableRow><TableCell sx={{ border: 0, py: 0.25, pl: 0 }}>Down payment</TableCell><TableCell align="right" sx={{ border: 0, py: 0.25, pr: 0 }}>−{money(q.downPayment)}</TableCell></TableRow>}
                {q.rows.length > 0 && <TableRow><TableCell sx={{ fontWeight: 800, color: '#0e4671', pl: 0 }}>Amount to finance</TableCell><TableCell align="right" sx={{ fontWeight: 800, color: '#0e4671', pr: 0 }}>{money(Math.max(q.loanAmount, 0))}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Your salesperson</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{q.salespersonName && q.salespersonName !== 'there' ? q.salespersonName : 'TIGON team'}</Typography>
            {q.store && <Typography color="text.secondary">TIGON Golf Carts {q.store.city}<br />{q.store.address}</Typography>}
            <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
              <Button variant="contained" startIcon={<Call />} href={`tel:${tel}`}>Call</Button>
              <Button variant="outlined" startIcon={<Sms />} href={`sms:${tel}`}>Text</Button>
              <Button variant="outlined" startIcon={<Event />} href={q.bookPath}>Book a test drive</Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {q.rows.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Monthly payment options</Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Months</TableCell><TableCell>Lender</TableCell><TableCell>Rate</TableCell><TableCell align="right">Monthly</TableCell><TableCell align="right">Total you'll pay</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {q.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontWeight: 700 }}>{r.term}</TableCell>
                      <TableCell>{r.lender}{r.note ? <Typography variant="caption" display="block" color="text.secondary">{r.note}</Typography> : null}</TableCell>
                      <TableCell>{r.rateLabel}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, color: '#af1f31', whiteSpace: 'nowrap' }}>{money(r.payment)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{money(r.totalOfPayments)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              Estimates only. Your rate and payment are set by the lender after a credit review. The rates shown are for the best credit tier.
            </Typography>
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 2, bgcolor: isInterested ? '#e8f5e9' : undefined }}>
        <CardContent sx={{ textAlign: 'center' }}>
          {isInterested ? (
            <>
              <CheckCircle color="success" sx={{ fontSize: 40 }} />
              <Typography sx={{ fontWeight: 700 }}>Thanks! {q.salespersonName && q.salespersonName !== 'there' ? q.salespersonName : 'We'} will reach out soon.</Typography>
            </>
          ) : (
            <>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Like what you see?</Typography>
              <Button variant="contained" size="large" startIcon={<ThumbUp />} onClick={() => setAsking(true)} disabled={q.expired || preview}>I'm interested</Button>
            </>
          )}
        </CardContent>
      </Card>
      {q.expiresAt > 0 && !q.expired && (
        <Typography variant="caption" color="text.secondary">Quote good until {new Date(q.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</Typography>
      )}

      <Dialog open={asking} onClose={() => setAsking(false)} fullWidth maxWidth="xs">
        <DialogTitle>Great! When's a good time to reach you?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Best time (optional)" placeholder="e.g. weekdays after 5, Saturday morning" value={when} onChange={(e) => setWhen(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <TextField label="Questions? (optional)" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
            {sendError && <Alert severity="error">{sendError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="contained" onClick={interested} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
        </DialogActions>
      </Dialog>
    </PublicShell>
  );
};

export default QuotePublicPage;
