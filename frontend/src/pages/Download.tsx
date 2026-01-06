import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Grid,
  Card,
  CardContent,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Chip,
  Alert,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Android as AndroidIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import DashboardLayout from '../components/Layout/DashboardLayout';
import { QRCodeSVG } from 'qrcode.react';

interface AppVersion {
  latestVersion: string;
  versionCode: number;
  downloadUrl: string;
  releaseNotes: string;
  mandatory: boolean;
}

const Download: React.FC = () => {
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAppVersion = async () => {
      try {
        const versionDoc = await getDoc(doc(db, 'appVersions', 'android'));
        if (versionDoc.exists()) {
          setAppVersion(versionDoc.data() as AppVersion);
        }
      } catch (error) {
        console.error('Error fetching app version:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAppVersion();
  }, []);

  const steps = [
    {
      label: 'Enable Unknown Sources',
      description: 'Go to Settings → Security → Enable "Install from Unknown Sources" or "Install unknown apps"',
    },
    {
      label: 'Download the APK',
      description: 'Click the download button below or scan the QR code with your phone',
    },
    {
      label: 'Install the App',
      description: 'Open the downloaded file and tap "Install"',
    },
    {
      label: 'Login',
      description: 'Open TIGON IOT and login with your @tigongolfcarts.com email',
    },
    {
      label: 'Choose Device Mode',
      description: 'Select Master (receives notifications) or Worker (monitors notifications)',
    },
    {
      label: 'Grant Permissions',
      description: 'Allow notification access when prompted',
    },
  ];

  const downloadUrl = appVersion?.downloadUrl || '#';
  const pageUrl = window.location.href;

  return (
    <DashboardLayout>
      <Box>
        <Typography variant="h4" gutterBottom color="primary" sx={{ mb: 3 }}>
          Download TIGON IOT App
        </Typography>

        <Grid container spacing={3}>
          {/* Download Card */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <AndroidIcon sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
              <Typography variant="h5" gutterBottom>
                TIGON IOT for Android
              </Typography>
              
              {loading ? (
                <Typography>Loading version info...</Typography>
              ) : appVersion ? (
                <>
                  <Chip
                    label={`Version ${appVersion.latestVersion}`}
                    color="primary"
                    sx={{ mb: 2 }}
                  />
                  {appVersion.mandatory && (
                    <Chip
                      label="Update Required"
                      color="error"
                      sx={{ mb: 2, ml: 1 }}
                    />
                  )}
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Latest version with bug fixes and improvements
                  </Typography>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<DownloadIcon />}
                    href={downloadUrl}
                    sx={{ mb: 2 }}
                    fullWidth
                  >
                    Download APK
                  </Button>
                  {appVersion.releaseNotes && (
                    <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>
                      <Typography variant="body2" fontWeight={600}>
                        What's New:
                      </Typography>
                      <Typography variant="body2">
                        {appVersion.releaseNotes}
                      </Typography>
                    </Alert>
                  )}
                </>
              ) : (
                <Alert severity="warning">
                  APK not available yet. Please check back later or contact support.
                </Alert>
              )}
            </Paper>
          </Grid>

          {/* QR Code Card */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h6" gutterBottom>
                Scan with Your Phone
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Open your camera app and point it at this QR code
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
                <QRCodeSVG
  value={pageUrl}
  size={200}
  level="H"
  includeMargin={true}
/>
              </Box>
              <Typography variant="caption" color="text.secondary">
                This will open this page on your phone for easy download
              </Typography>
            </Paper>
          </Grid>

          {/* System Requirements */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <InfoIcon /> System Requirements
                </Typography>
                <Box component="ul" sx={{ pl: 2 }}>
                  <li>
                    <Typography variant="body2">Android 8.0 (Oreo) or higher</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">At least 50 MB free storage</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Internet connection required</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Notification access permission</Typography>
                  </li>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Features */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircleIcon /> Features
                </Typography>
                <Box component="ul" sx={{ pl: 2 }}>
                  <li>
                    <Typography variant="body2">Real-time notification relay</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Master and Worker device modes</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Facebook Marketplace notification support</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Notification history</Typography>
                  </li>
                  <li>
                    <Typography variant="body2">Secure @tigongolfcarts.com authentication</Typography>
                  </li>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Installation Instructions */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom color="primary">
                Installation Instructions
              </Typography>
              <Stepper orientation="vertical">
                {steps.map((step) => (
                  <Step key={step.label} active={true}>
                    <StepLabel>
                      <Typography variant="body1" fontWeight={600}>
                        {step.label}
                      </Typography>
                    </StepLabel>
                    <StepContent>
                      <Typography variant="body2" color="text.secondary">
                        {step.description}
                      </Typography>
                    </StepContent>
                  </Step>
                ))}
              </Stepper>
            </Paper>
          </Grid>

          {/* Support */}
          <Grid item xs={12}>
            <Alert severity="info">
              <Typography variant="body2">
                <strong>Need Help?</strong> If you encounter any issues during installation or setup,
                please contact your system administrator or IT support.
              </Typography>
            </Alert>
          </Grid>
        </Grid>
      </Box>
    </DashboardLayout>
  );
};

export default Download;