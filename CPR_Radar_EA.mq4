//+------------------------------------------------------------------+
//| CPR Radar EA — storiesbyachu                                     |
//| Connects to Railway cloud server — works 24/7                   |
//+------------------------------------------------------------------+
#property copyright "storiesbyachu"
#property version   "2.00"
#property strict
input string ServerURL = "https://web-production-1f4f7.up.railway.app";
input double LotSize      = 0.01;
input int    PollSeconds  = 30;
input int    Slippage     = 3;
input bool   EnableTrading = true;

string   baseUrl;
long     lastSignalId = 0;
bool     initialized  = false;
int      openTickets[];
int      openTicketCount = 0;

int OnInit() {
   baseUrl = ServerURL;
   Print("CPR Radar EA v2.00 | Server: ", baseUrl);
   EventSetTimer(PollSeconds);
   FetchLastSignalId();
   ScanOpenPositions();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void FetchLastSignalId() {
   string url=baseUrl+"/api/signals/last", headers="", result="";
   char post[], response[];
   int res=WebRequest("GET",url,headers,8000,post,response,headers);
   if (res!=-1) {
      result=CharArrayToString(response);
      long id=ParseLong(result,"\"lastSignalId\":");
      if (id>0){lastSignalId=id;Print("Restored lastSignalId: ",lastSignalId);}
   }
   initialized=true;
}

void ScanOpenPositions() {
   openTicketCount=0; ArrayResize(openTickets,0);
   for (int i=0;i<OrdersTotal();i++)
      if (OrderSelect(i,SELECT_BY_POS,MODE_TRADES))
         if (OrderSymbol()==Symbol()&&StringFind(OrderComment(),"CPR_")>=0)
            AddOpenTicket(OrderTicket());
}

void AddOpenTicket(int ticket){
   ArrayResize(openTickets,openTicketCount+1);
   openTickets[openTicketCount]=ticket; openTicketCount++;
}

void RemoveOpenTicket(int ticket){
   for (int i=0;i<openTicketCount;i++)
      if (openTickets[i]==ticket){
         for (int j=i;j<openTicketCount-1;j++) openTickets[j]=openTickets[j+1];
         openTicketCount--; ArrayResize(openTickets,openTicketCount); return;
      }
}

void OnTimer(){
   if (!initialized){FetchLastSignalId();return;}
   CheckForClosedTrades();
   if (!EnableTrading||!IsTradeAllowed()||!IsConnected()) return;
   CheckForSignal();
}

void CheckForClosedTrades(){
   for (int i=openTicketCount-1;i>=0;i--){
      int ticket=openTickets[i];
      if (!OrderSelect(ticket,SELECT_BY_TICKET,MODE_TRADES)){
         if (OrderSelect(ticket,SELECT_BY_TICKET,MODE_HISTORY)){
            double closePrice=OrderClosePrice();
            double pnl=OrderProfit()+OrderSwap()+OrderCommission();
            string reason="MANUAL";
            if (OrderType()==OP_BUY){
               if (closePrice>=OrderTakeProfit()-0.001) reason="TP";
               else if (closePrice<=OrderStopLoss()+0.001) reason="SL";
            } else {
               if (closePrice<=OrderTakeProfit()+0.001) reason="TP";
               else if (closePrice>=OrderStopLoss()-0.001) reason="SL";
            }
            Print("Trade closed! Ticket:",ticket," Reason:",reason," PnL:",pnl);
            ReportTradeClosed(ticket,closePrice,pnl,reason);
            RemoveOpenTicket(ticket);
         }
      }
   }
}

void ReportTradeClosed(int ticket,double closePrice,double pnl,string reason){
   string url=baseUrl+"/api/trades/close";
   string headers="Content-Type: application/json\r\n";
   string body="{\"ticket\":"+IntegerToString(ticket)+
               ",\"closePrice\":"+DoubleToStr(closePrice,5)+
               ",\"pnl\":"+DoubleToStr(pnl,2)+
               ",\"reason\":\""+reason+"\"}";
   char post[],response[];
   ArrayResize(post,StringLen(body));
   StringToCharArray(body,post,0,StringLen(body));
   WebRequest("POST",url,headers,8000,post,response,headers);
}

void CheckForSignal(){
   string url=baseUrl+"/api/signals", headers="";
   char post[],response[];
   int res=WebRequest("GET",url,headers,8000,post,response,headers);
   if (res==-1){Print("Signal poll failed: ",GetLastError());return;}
   string result=CharArrayToString(response);
   if (StringFind(result,"\"signal\":false")>=0) return;
   if (StringFind(result,"\"signal\":true")<0) return;

   string direction=ParseString(result,"\"direction\":\"","\"");
   double entry=ParseDouble(result,"\"entry\":");
   double sl=ParseDouble(result,"\"sl\":");
   double tp=ParseDouble(result,"\"tp\":");
   long   sigId=ParseLong(result,"\"id\":");

   if (sigId==0||sigId==lastSignalId){Print("Already processed: ",sigId);return;}
   Print("Signal! ",direction," Entry:",entry," SL:",sl," TP:",tp);

   int ticket=ExecuteTrade(direction,entry,sl,tp,sigId);
   if (ticket>0){
      lastSignalId=sigId;
      AddOpenTicket(ticket);
      ConfirmSignal(sigId,ticket);
   }
}

int ExecuteTrade(string direction,double entry,double sl,double tp,long sigId){
   int    cmd=(direction=="LONG")?OP_BUY:OP_SELL;
   double price=(cmd==OP_BUY)?Ask:Bid;
   string comment="CPR_"+IntegerToString(sigId);
   sl=NormalizeDouble(sl,Digits); tp=NormalizeDouble(tp,Digits);
   if (cmd==OP_BUY&&(sl>=price||tp<=price)){Print("Invalid BUY levels");return -1;}
   if (cmd==OP_SELL&&(sl<=price||tp>=price)){Print("Invalid SELL levels");return -1;}
   if (CountOpenPositions()>0){Print("Position already open");return -1;}
   int ticket=OrderSend(Symbol(),cmd,LotSize,price,Slippage,sl,tp,comment,0,0,
                        (cmd==OP_BUY)?clrGreen:clrRed);
   if (ticket<0){Print("OrderSend failed: ",GetLastError());return -1;}
   Print("Order placed! Ticket:",ticket," ",direction," @",price);
   return ticket;
}

int CountOpenPositions(){
   int count=0;
   for (int i=0;i<OrdersTotal();i++)
      if (OrderSelect(i,SELECT_BY_POS,MODE_TRADES))
         if (OrderSymbol()==Symbol()&&StringFind(OrderComment(),"CPR_")>=0)
            count++;
   return count;
}

void ConfirmSignal(long sigId,int ticket){
   string url=baseUrl+"/api/signals/confirm";
   string headers="Content-Type: application/json\r\n";
   double price=(OrderSelect(ticket,SELECT_BY_TICKET,MODE_TRADES))?OrderOpenPrice():0;
   string body="{\"id\":"+IntegerToString(sigId)+
               ",\"ticket\":"+IntegerToString(ticket)+
               ",\"entryPrice\":"+DoubleToStr(price,5)+"}";
   char post[],response[];
   ArrayResize(post,StringLen(body));
   StringToCharArray(body,post,0,StringLen(body));
   WebRequest("POST",url,headers,8000,post,response,headers);
   Print("Confirmed: sigId=",sigId," ticket=",ticket);
}

string ParseString(string json,string key,string endDelim){
   int start=StringFind(json,key); if (start<0) return "";
   start+=StringLen(key);
   int end=StringFind(json,endDelim,start); if (end<0) return "";
   return StringSubstr(json,start,end-start);
}
double ParseDouble(string json,string key){
   int start=StringFind(json,key); if (start<0) return 0;
   return StringToDouble(StringSubstr(json,start+StringLen(key),20));
}
long ParseLong(string json,string key){
   int start=StringFind(json,key); if (start<0) return 0;
   return StringToInteger(StringSubstr(json,start+StringLen(key),20));
}

void OnTick(){}
//+------------------------------------------------------------------+
