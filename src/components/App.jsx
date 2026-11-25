import React from "react";
import ToastHost from "./elements/ToastHost"
import Header from './header'
import Main from "./Main"
import Alert from "./elements/alert/Alert"
import Dialog from './elements/dialog/Dialog'
import useDialogStore from "../store/dialog";

const App = () => {
  const { ...dialog_props } = useDialogStore()

  return (
    <>
      <Header />
      <Main />
      <Alert />
      <ToastHost />
      <Dialog {...dialog_props} />
    </>
  );
};

export default App;