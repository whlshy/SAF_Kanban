import React, { useMemo } from "react";
import { createTheme, ThemeProvider } from '@mui/material/styles';
import ToastHost from "./elements/ToastHost"
import Header from './header'
import Main from "./Main"
import Alert from "./elements/alert/Alert"
import Dialog from './elements/dialog/Dialog'
import useDialogStore from "../store/dialog";
import { useTheme } from '@/store/theme';

const App = () => {
  const { ...dialog_props } = useDialogStore()
  const { isDark } = useTheme()

  const muiTheme = useMemo(() => createTheme({
    palette: isDark
      ? {
          mode: 'dark',
          primary: { main: '#58a6ff' },
          background: { default: '#0d1117', paper: '#1c2128' },
          text: { primary: '#e6edf3', secondary: '#9198a1' },
          divider: 'rgba(255, 255, 255, 0.12)',
        }
      : {
          mode: 'light',
        },
    components: isDark
      ? {
          MuiPaper: {
            styleOverrides: {
              root: { backgroundImage: 'none' },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: {
                backgroundColor: '#1c2128',
                border: '1px solid #3d444d',
                boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
              },
            },
          },
          MuiMenu: {
            styleOverrides: {
              paper: {
                backgroundColor: '#252b33',
                border: '1px solid #3d444d',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
              },
            },
          },
          MuiPopover: {
            styleOverrides: {
              paper: {
                backgroundColor: '#252b33',
                border: '1px solid #3d444d',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
              },
            },
          },
          MuiMenuItem: {
            styleOverrides: {
              root: {
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
                '&.Mui-selected': { backgroundColor: 'rgba(56, 139, 253, 0.18)' },
                '&.Mui-selected:hover': { backgroundColor: 'rgba(56, 139, 253, 0.26)' },
              },
            },
          },
        }
      : undefined,
  }), [isDark])

  return (
    <ThemeProvider theme={muiTheme}>
      <Header />
      <Main />
      <Alert />
      <ToastHost />
      <Dialog {...dialog_props} />
    </ThemeProvider>
  );
};

export default App;