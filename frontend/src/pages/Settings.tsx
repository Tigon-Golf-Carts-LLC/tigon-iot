import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Divider,
  Switch,
  FormControlLabel,
  Alert,
  Card,
  CardContent,
} from '@mui/material';
import {
  Save as SaveIcon,
  Password as PasswordIcon,
  Delete as DeleteIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import DashboardLayout from '../components/Layout/DashboardLayout';
import { updatePassword, deleteUser, sendEmailVerification } from 'firebase/auth';

const Settings: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [browserNotifications, setBrowserNotifications] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleChangePassword = async () => {
    if (!currentUser) return;

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      await updatePassword(currentUser, newPassword);
      setSuccess('Password updated successfully!');
      setError('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError('Failed to update password. You may need to login again.');
    }
  };

  const handleResendVerification = async () => {
    if (!currentUser) return;

    try {
      await sendEmailVerification(currentUser);
      setSuccess('Verification email sent!');
      setError('');
    } catch (err: any) {
      setError('Failed to send verification email');
    }
  };

  const handleDeleteAccount = async () => {
    if (!currentUser) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.'
    );

    if (!confirmed) return;

    const doubleConfirm = window.confirm(
      'This will permanently delete all your data. Are you absolutely sure?'
    );

    if (!doubleConfirm) return;

    try {
      await deleteUser(currentUser);
      await logout();
    } catch (err: any) {
      setError('Failed to delete account. You may need to login again first.');
    }
  };

  return (
    <DashboardLayout>
      <Box>
        <Typography variant="h4" gutterBottom color="primary" sx={{ mb: 3 }}>
          Settings
        </Typography>

        {success && <Alert severity="success" sx={{ mb: 3 }}>{success}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Grid container spacing={3}>
          {/* Account Information */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <EmailIcon /> Account Information
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Email Address
                </Typography>
                <Typography variant="body1" fontWeight={500}>
                  {currentUser?.email}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Email Verified
                </Typography>
                <Typography variant="body1" fontWeight={500}>
                  {currentUser?.emailVerified ? '✅ Yes' : '❌ No'}
                </Typography>
                {!currentUser?.emailVerified && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleResendVerification}
                    sx={{ mt: 1 }}
                  >
                    Resend Verification Email
                  </Button>
                )}
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Account Created
                </Typography>
                <Typography variant="body1" fontWeight={500}>
                  {currentUser?.metadata.creationTime
                    ? new Date(currentUser.metadata.creationTime).toLocaleDateString()
                    : 'Unknown'}
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Change Password */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PasswordIcon /> Change Password
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                fullWidth
                type="password"
                label="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                margin="normal"
                helperText="Minimum 8 characters"
              />
              <TextField
                fullWidth
                type="password"
                label="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                margin="normal"
              />
              <Button
                fullWidth
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleChangePassword}
                sx={{ mt: 2 }}
                disabled={!newPassword || !confirmPassword}
              >
                Update Password
              </Button>
            </Paper>
          </Grid>

          {/* Notification Preferences */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom color="primary">
                Notification Preferences
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                  />
                }
                label="Sound Notifications"
              />
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 2, ml: 4 }}>
                Play sound when new notifications arrive
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={browserNotifications}
                    onChange={(e) => setBrowserNotifications(e.target.checked)}
                  />
                }
                label="Browser Notifications"
              />
              <Typography variant="caption" display="block" color="text.secondary" sx={{ ml: 4 }}>
                Show desktop notifications (requires permission)
              </Typography>
            </Paper>
          </Grid>

          {/* Data Management */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom color="primary">
                Data Management
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Typography variant="body2" color="text.secondary" paragraph>
                Notifications older than 30 days are automatically deleted.
              </Typography>

              <Button
                variant="outlined"
                color="primary"
                fullWidth
                sx={{ mb: 2 }}
                onClick={() => alert('Export feature coming soon!')}
              >
                Export All Data
              </Button>

              <Button
                variant="outlined"
                color="warning"
                fullWidth
                onClick={() => {
                  if (confirm('Delete all notifications? This cannot be undone.')) {
                    alert('Delete all notifications feature coming soon!');
                  }
                }}
              >
                Delete All Notifications
              </Button>
            </Paper>
          </Grid>

          {/* Danger Zone */}
          <Grid item xs={12}>
            <Card sx={{ bgcolor: '#fff5f5', borderColor: 'error.main', border: 1 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom color="error" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DeleteIcon /> Danger Zone
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Typography variant="body2" color="text.secondary" paragraph>
                  Once you delete your account, there is no going back. This will permanently delete
                  your profile, all devices, and all notifications.
                </Typography>

                <Button
                  variant="contained"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDeleteAccount}
                >
                  Delete Account
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </DashboardLayout>
  );
};

export default Settings;