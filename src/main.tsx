import React from 'react';
import ReactDOM from 'react-dom/client';
import ProductApp from './product/ProductApp';
import './styles.css';
import './product/product.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ProductApp />
  </React.StrictMode>,
);
