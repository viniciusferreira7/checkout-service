export interface PaymentOrderMessage {
  orderId: string;
  userId: string;
  amount: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  description?: string;
  createAt: Date;
}
