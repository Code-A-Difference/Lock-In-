const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React from 'react';

import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserPlus } from "lucide-react";

export default function JoinFriendClassDialog({ open, onOpenChange, user, onJoin }) {
  const { data: friendRequests = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: () => db.entities.Friend.list(),
    enabled: !!user
  });

  const { data: allClasses = [] } = useQuery({
    queryKey: ['classes'],
    queryFn: () => db.entities.Class.list()
  });

  const myFriends = friendRequests.filter(f => 
    (f.requester_email === user?.email || f.recipient_email === user?.email) && 
    f.status === 'accepted'
  );

  const getFriendEmail = (friend) => {
    return friend.requester_email === user?.email ? friend.recipient_email : friend.requester_email;
  };

  const friendClasses = allClasses.filter(c => 
    myFriends.some(f => {
      const friendEmail = getFriendEmail(f);
      return c.members?.includes(friendEmail) && !c.members?.includes(user?.email);
    })
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-green-500" />
            Join Friend's Class
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          {myFriends.length === 0 ? (
            <p className="text-center py-8 text-slate-500">
              You don't have any friends yet. Add friends in Settings to join their classes!
            </p>
          ) : friendClasses.length === 0 ? (
            <p className="text-center py-8 text-slate-500">
              Your friends don't have any classes you can join yet.
            </p>
          ) : (
            friendClasses.map(cls => (
              <Card key={cls.id} className="hover:border-green-300 transition-colors">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium">{cls.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {cls.teacher && (
                          <Badge variant="secondary" className="text-xs">
                            {cls.teacher}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          <Users className="w-3 h-3 mr-1" />
                          {cls.members?.length || 0} members
                        </Badge>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => onJoin(cls.id)}>
                      Join
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}